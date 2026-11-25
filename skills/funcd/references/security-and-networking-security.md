# Security

Source: https://funcd.dev/docs/develop/security-and-networking/security.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Choose a role
- Choose the scope of a grant
- Write a Policy
- Access
- Data storage
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Create an Identity for a client outside funcd, give roles to it and to Functions at a scope, and allow or forbid requests with a Cedar Policy.

## Usage

funcd [checks each request](https://funcd.dev/docs/platform/security-and-networking/security.md) for data and refuses it unless
something allows it. The first example gives a client outside funcd, curl, read access to an object that a Function
wrote into a Bucket: the read succeeds, and a write fails with `AccessDenied`.

It needs the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git, curl 8.0 or later for `--aws-sigv4`, jq
1.6 or later for `@base64d`, and Node.js on the `PATH`. `funcdctl dev` also runs funcd's **S3 gateway**, on the port
of `--s3port`. Clone both repositories into one folder and start the s3-roundtrip example:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ git clone https://github.com/pyvvo/funcd
$ cd funcd-typescript
$ funcdctl dev examples/s3-roundtrip --gport 8080 --cport 8081 --s3port 8082
```

The Function owns the prefix `gold` of the [Bucket](https://funcd.dev/docs/develop/services/bucket.md) `lakehouse`, and writes it with no
role. In another terminal, from the folder that holds both clones, let it write `gold/roundtrip-001.txt`:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"inv":"001"}' http://127.0.0.1:8080/function/s3-roundtrip
{"put":true,"get":true,"list":1,"denied":false,"granted":true}
```

An **Identity** stands for a client outside funcd:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Identity
metadata:
  name: analyst
  namespace: default
  resourceGroup: rg1
spec:
  type: external
```

funcd writes its credential into a Secret named after it, or after
[`credentialSecretName`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#identityspec): an S3 key pair, `accessKeyId` and `secretAccessKey`, and a
[Lake](https://funcd.dev/docs/develop/services/lake.md#access) token, `lakeToken`. A credential only proves who the client is.

A **RolesAssignment** gives roles: each [entry](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignments) gives one role to one
**principal**, a Function or an Identity, on one **scope**. This one gives `analyst` `Blob Data Reader` on the prefix
`gold`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: analyst-reads-gold
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Identity
    name: analyst
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: Blob Data Reader
      scope:
        kind: BucketPrefix
        name: lakehouse/gold
```

Apply both:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f funcd/api/types/v1alpha1/examples/security/identity.yaml
applied Identity/analyst
applied RolesAssignment/analyst-reads-gold
```

The credential comes after the apply; repeat until the Identity's phase is `Ready`:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token get identity analyst -n default -o json
```

Read the key pair from the Secret; funcdctl prints Secret values in base64:

```console
$ KEY_ID=$(funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token get secret analyst -n default -o json | jq -r '.spec.data.accessKeyId | @base64d')
$ SECRET_KEY=$(funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token get secret analyst -n default -o json | jq -r '.spec.data.secretAccessKey | @base64d')
```

Read the object as `analyst`, then try to write:

```console
$ curl -s -w '\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" http://127.0.0.1:8082/lakehouse/gold/roundtrip-001.txt
roundtrip-001
$ curl -s -w '\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" -X PUT --data-binary draft http://127.0.0.1:8082/lakehouse/gold/draft.txt
<?xml version="1.0" encoding="UTF-8"?>
<Error><Code>AccessDenied</Code><Message>Access Denied.</Message><RequestId>JZVQER1LLBCXW5PG</RequestId><HostId>+StDZ2GlZ/+qPaz5nqjiKzTpySRQDBJfLPzShaDl1h6aoK21GI3btH9kXuFim3eUdaW1VlxlM1SEou+xvEvXW5o=</HostId></Error>
```

The S3 gateway's one region is `us-east-1`. The role allows reading only. Keep the example running for the next
sections, which use `KEY_ID` and `SECRET_KEY`; stopping it loses the Identity and its credential.

## Choose a role

An **action** is an operation that funcd checks, such as `s3::read`. A role allows a set of actions: an entry's
[`roleRef`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignmentsroleref) names a built-in role, with `kind: BuiltinRole`, or a
**Role** of the namespace, with `kind: Role`.

A role is needed only beyond what a principal gets by itself, which [Access](#access) lists, and only for requests that
the principal can send: a Function reaches a store only through its own bindings, which no role creates, and an
Identity only through the S3 gateway or a Lake's gateway.

- `Blob Data Reader` allows `s3::read`, and `Blob Data Writer` adds `s3::write`: an Identity uses them through the S3
  gateway, and a Function through it or `ctx.blob` ([Bucket](https://funcd.dev/docs/develop/services/bucket.md#access)).
- `KV Data Writer`, `SQL Data Writer` and `Secret Data Writer` let a Function write a bound
  [KV](https://funcd.dev/docs/develop/services/kv.md#access) table, [SQL](https://funcd.dev/docs/develop/services/sql.md#access) database or
  [Secret](https://funcd.dev/docs/develop/services/secrets.md#let-another-function-write-a-secret) that it does not own.
- `Lake Query Reader` and `Lake Contributor` allow `lake::query` through a Lake's gateway.
- `Reader` allows `s3::read` and `kv::read`, and `Contributor` and `Owner` also the writes.
- `KV Data Reader`, `SQL Data Reader`, `Secret Data Reader` and `Function Invoker` add nothing to a Function's own
  bindings and links.

A Role lists its [`actions`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolespec); an unknown action allows nothing. `object-writer` allows `s3::write`
alone, for a client that only uploads, and `analyst-writes-shared` gives it on the prefix `shared`, which has no owner:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Role
metadata:
  name: object-writer
  namespace: default
  resourceGroup: rg1
spec:
  actions:
    - s3::write
```

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: analyst-writes-shared
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Identity
    name: analyst
  assignments:
    - roleRef:
        kind: Role
        name: object-writer
      scope:
        kind: BucketPrefix
        name: lakehouse/shared
```

Apply the [file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/security/role.yaml), which also
holds the unchanged Identity, then write and read back:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f funcd/api/types/v1alpha1/examples/security/role.yaml
applied Identity/analyst
applied Role/object-writer
applied RolesAssignment/analyst-writes-shared
$ curl -s -o /dev/null -w '%{http_code}\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" -X PUT --data-binary report http://127.0.0.1:8082/lakehouse/shared/report.txt
200
$ curl -s -o /dev/null -w '%{http_code}\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" http://127.0.0.1:8082/lakehouse/shared/report.txt
403
```

An entry naming a role that does not exist gives nothing until a Role of that name exists.

## Choose the scope of a grant

An entry's [`scope`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecscope), in the RolesAssignment's namespace, is one of:

- `Namespace`: every resource of the namespace;
- `BucketPrefix` `<bucket>/<prefix>`: one prefix, since no scope covers a whole Bucket;
- `KVStore` `<store>` or `<store>/<table>`;
- `SQLDatabase`, `Lake` or `Secret`, with the resource's name.

A role applies only to resources of its kind. funcd checks neither the
[principal](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecprincipal) nor the resource: a grant applies to whatever has those names, once
it exists. [`spec.principal`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspec) and `spec.scope` serve the entries that set none:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: analyst-reads-namespace
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Identity
    name: analyst
  scope:
    kind: Namespace
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: Blob Data Reader
    - roleRef:
        kind: BuiltinRole
        name: Lake Query Reader
```

Apply the [file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/security/rolesassignment.yaml)
and read what the previous section wrote:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f funcd/api/types/v1alpha1/examples/security/rolesassignment.yaml
applied Identity/analyst
applied RolesAssignment/analyst-reads-namespace
$ curl -s -w '\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" http://127.0.0.1:8082/lakehouse/shared/report.txt
report
```

A principal's grants add up: bindings, ownerships, roles and Policy `permit`s. A request is allowed when one allows it
and no `forbid` refuses it.

## Write a Policy

A **Policy** holds [Cedar](https://www.cedarpolicy.com/) statements in its [`cedar`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#policyspec) field, which
funcd decides together with the RolesAssignments and the built-in rules quoted on each service's Access section. A
`forbid` wins over a binding, an ownership, a role and a `permit`. A statement is a `permit` or a `forbid` of:

- a principal: `principal`, or `principal == <entity>`;
- one action: `s3::read`, `s3::write`, `kv::read`, `kv::write`, `sql::read`, `sql::write`, `lake::query`,
  `secret::read`, `secret::write`, `link::invoke`, `job::start`, `job::read` or `egress::connect`;
- a resource: `resource`, `resource == <entity>`, or `resource in <entity>` for what the entity holds;
- an optional `when` or `unless` condition on attributes.

The entities, with IDs prefixed by their namespace except the last:

- `Function`, `Job`, `Identity` and `Lake`, the principals; a Lake is also the resource of `lake::query`, a Function
  of `link::invoke`, and a Job of `job::start` and `job::read`, the start and the read of its runs from a Function;
- `BlobPrefix::"<ns>/<bucket>/<prefix>"`, held by `Bucket::"<ns>/<bucket>"`;
- `KVTable::"<ns>/<store>/<table>"`, held by `KVStore::"<ns>/<store>"`;
- `SQLDatabase::"<ns>/<database>"` and `Secret::"<ns>/<name>"`;
- `NetDestination::"<ip>:<port>"`, of `egress::connect`, with `ip`, `port` and `domains`, the names that resolved to
  that address through funcd; `domains` is empty for a private address. See
  [outbound connections](https://funcd.dev/docs/develop/security-and-networking/networking.md#allow-a-functions-outbound-connections).

Entities that exist have `namespace`, and stores, prefixes, databases and principals also `resourceGroup`. This Policy
forbids `analyst` every write into `lakehouse`, whatever its roles:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Policy
metadata:
  name: analyst-writes-nothing
  namespace: default
  resourceGroup: rg1
spec:
  cedar: |
    forbid(
      principal == Identity::"default/analyst",
      action == Action::"s3::write",
      resource in Bucket::"default/lakehouse"
    );
```

Apply the [file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/security/policy.yaml), write,
delete the Policy, and write again:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f funcd/api/types/v1alpha1/examples/security/policy.yaml
applied Identity/analyst
applied Policy/analyst-writes-nothing
$ curl -s -o /dev/null -w '%{http_code}\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" -X PUT --data-binary report http://127.0.0.1:8082/lakehouse/shared/report.txt
403
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token delete policy analyst-writes-nothing -n default
deleted Policy/analyst-writes-nothing
$ curl -s -o /dev/null -w '%{http_code}\n' --aws-sigv4 aws:amz:us-east-1:s3 --user "$KEY_ID:$SECRET_KEY" -X PUT --data-binary report http://127.0.0.1:8082/lakehouse/shared/report.txt
200
```

Press Ctrl-C in the first terminal to stop.

funcd refuses a Policy that does not parse, holds no statement, names no single known action, or names an entity of an
unknown type or another namespace with `==` or `in`, such as `cedar policy references unknown action "s3::delete"`. A
Policy decides only requests whose principal and resource are in its namespace. A `permit` cannot allow a write that the
built-in rules forbid; it widens only S3 requests, Lake queries and outbound connections, such as `s3::read` on
`resource in Bucket::"default/lakehouse"`, a scope that no RolesAssignment has.

## Access

Without a role:

- A Function reads the KV tables, prefixes, SQL databases and Secrets that it binds, queries its bound Lakes, writes
  what it owns, and calls its links' targets ([KV](https://funcd.dev/docs/develop/services/kv.md#access),
  [Bucket](https://funcd.dev/docs/develop/services/bucket.md#access), [SQL](https://funcd.dev/docs/develop/services/sql.md#access),
  [Lake](https://funcd.dev/docs/develop/services/lake.md#access), [Secrets](https://funcd.dev/docs/develop/services/secrets.md#access),
  [Function](https://funcd.dev/docs/develop/workloads/function.md#access)).
- A Lake's engine reads its Lake's prefixes and Secrets, and writes the prefix that it owns.
- An Identity gets nothing.
- No principal gets an outbound connection without an EgressPolicy or a `permit`
  ([Networking](https://funcd.dev/docs/develop/security-and-networking/networking.md#access)).

A denial reads:

- through the S3 gateway, `AccessDenied` with 403, naming no rule;
- through a Lake's gateway, 403 `lake query denied` on the session's first request;
- through a context client, 403 naming the `forbid`: `cedar: forbidden by policy builtin/<rule>`, or
  `<namespace>/<policy>#<n>` for a Policy's statement `n`, from 0;
- for an outbound connection, as [Networking](https://funcd.dev/docs/develop/security-and-networking/networking.md#allow-a-functions-outbound-connections) shows.

To clear it, give a role on a scope that holds the resource, or remove the statement that the message names.

The API's own objects, these included, are decided by the role of the caller's credential, not by Cedar:

- an `admin` acts everywhere;
- a `developer` manages Identities, Roles, RolesAssignments and Policies in its namespaces and reads their Secrets;
  `funcd-dev-token` is a developer of `default`;
- a `viewer` reads them but never a Secret.

A refused request gets 403, such as `get Secret in "default" denied: viewer may not act on kind "Secret"`. No data role,
not even `Owner`, lets a principal change a RolesAssignment. Calls through the edge use the API's credentials, not the
Identities', as [Networking](https://funcd.dev/docs/develop/security-and-networking/networking.md#access) explains.

## Data storage

Identities, Roles, RolesAssignments and Policies live in funcd's metastore, and each credential in its Identity's
Secret, stored as every [Secret](https://funcd.dev/docs/develop/services/secrets.md#data-storage).

## Status

`funcdctl get identity <name> -n <namespace> -o json` prints an Identity's status:

| Phase | Condition `Ready` | Meaning |
| --- | --- | --- |
| `Ready` | `True`, with no reason | funcd has written the credential into the Secret. |
| `Pending` | `False`, `SecretNotOwned` | The Secret that the Identity names exists, and no Identity of that name controls it, with a message such as `secret not owned: secret "app-secret" is not controlled by identity "analyst"`. Name another Secret, one that does not exist yet, in `credentialSecretName`. Delete the existing Secret instead only when nothing else uses it: it may hold an App's data or another Identity's credential. funcd checks the Identity again every `runtime.supervisionPeriod`, 10 seconds by default. |
| `Pending` | `False`, `SecretIssueFailed` | funcd could not write the Secret. The condition's message gives the cause. |

`status.accessKeyId` holds the key ID, and `status.observedRotate` the last issued [`rotate`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#identityspec).
Roles, RolesAssignments and Policies have no status: test them with a request.

## Changes and deletion

- A change or deletion of a Role, RolesAssignment or Policy applies from the next request.
- Raising an Identity's [`rotate`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#identityspec) writes a new `secretAccessKey` and `lakeToken` under the same
  key ID; the old secret fails at once with `SignatureDoesNotMatch`.
- Deleting an Identity deletes its Secret, and its key gets `InvalidAccessKeyId`. Its RolesAssignments stay, for a new
  Identity of the same name.
- A Lake session already open goes on after a rotation or a lost access; only new sessions are refused.
- A grant or Policy that names a Function sharing a [pooled worker](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecpooling)
  moves it to a worker of Functions with the same access; meanwhile its calls get 404, then 503.

## CLI errors

These errors stop a command before any server answers. `funcdctl apply` checks each document before it sends it, and
its message starts with `manifest is invalid (<kind> "<name>")`:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | `funcdctl dev` found no Node.js for the example's Function. Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `<folder> holds no Function or Workflow image step to run` | `funcdctl dev` does not start on a folder of Identities and grants alone. Start an example that holds a Function, and apply them to it, as the first example does. |
| `<file>: <kind> "<name>" is in namespace "<namespace>"; funcdctl dev runs namespace default only` | Remove `metadata.namespace` from the object, set it to `default`, or apply the file to a funcd server. |
| `spec.type must be "external" (got "<type>")` | Set the Identity's `type` to `external`. |
| `spec.actions must list at least one action` | List an action in the Role's `actions`. |
| `spec.assignments[<n>] has no principal (and no top-level default)`, `has no scope`, or `roleRef.name is required` | Set the entry's `principal`, `scope` or `roleRef.name`, or `spec.principal` or `spec.scope` for every entry. |
| `spec.assignments[<n>].scope.kind "<kind>" is invalid`, or the same for `principal.kind` or `roleRef.kind` | Use a kind that the [Spec](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignments) tab lists. |

## Run it locally

`funcdctl dev` decides requests with the same rules as a server, except:

- It runs the namespace `default` only.
- It always runs the S3 gateway; a server runs it only with
  [`s3gateway.enabled: true`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml), at `127.0.0.1:9000` by default.
- It gives each Function the Role `dev-blob-writer`, `s3::write` on the namespace, so a local write can fail once
  deployed; a Policy's `forbid` still applies.
- It needs a Function or a Workflow image step in its folder.
- Its edge has no authenticator.

Each run issues a new secret; with [`--persist`](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-dev), credentials are kept,
unencrypted, in `.funcd-dev`.

## Examples

- [s3-roundtrip in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/s3-roundtrip): the Bucket
  and Function of this page, with a writer role on one prefix.
