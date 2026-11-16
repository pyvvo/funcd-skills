# Bucket

Source: https://pyvvo.github.io/funcd/docs/develop/services/bucket.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Use ctx.blob instead of an S3 client
- Share a Bucket between Functions
- Access
- Limits and quotas
- Data storage
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Declare a Bucket and its prefixes, bind a prefix to a Function, and read and write its objects over S3 or through ctx.blob.

## Usage

A Bucket holds objects under **prefixes**, each a separate set of objects inside the Bucket. A Function reaches a
prefix through a **binding**, and its handler reads and writes the prefix's objects with an S3 client, which sends its
requests to funcd's **S3 gateway**, or through `ctx.blob`, the blob client of the context that every handler receives.
See [how Buckets work](https://pyvvo.github.io/funcd/docs/platform/services/bucket.md) for the concept.

The s3-roundtrip example writes an object with an S3 client and reads it back. Each call sends a tag; the Function
writes an object named after the tag into the prefix `gold`, reads it back, and counts the objects under `gold`. The
example exists in TypeScript only. `ctx.blob` is available in both languages, as
[Use ctx.blob instead of an S3 client](#use-ctxblob-instead-of-an-s3-client) shows.

Install the [dev build of funcdctl](https://pyvvo.github.io/funcd/docs/get-started/install.md), Git and curl, and put Node.js on the `PATH`.

`funcdctl dev` starts a local platform, applies the resource files of one folder, and prints the URL of each Function,
on the port that `--gport` sets. It runs the Function from the built file `s3-roundtrip.mjs` in the folder, not from
the manifest's `image`, the bundle that `funcdctl push` writes for a platform to run. That file already contains the
AWS SDK for JavaScript, so the example needs no install step. `funcdctl dev` also runs the S3 gateway, and keeps the
Bucket's objects in memory.

A Function's code runs in its [workers](https://pyvvo.github.io/funcd/docs/platform/workloads.md#runtime), processes that funcd starts.
While the S3 gateway runs, each worker of a Function that binds a prefix gets the gateway's address and an S3 key pair
of the Function's own, in the standard AWS variables `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID` and
`AWS_SECRET_ACCESS_KEY`. On a platform, the gateway runs only when the operator sets `s3gateway.enabled: true` in
[funcd's configuration](https://pyvvo.github.io/funcd/docs/develop/running-funcd/spec.md#funcdconfigyaml).

### TypeScript

Clone the repository and start the example from its root folder:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/s3-roundtrip --gport 8080
```

In another terminal, call the Function twice, with the tags `001` and `002`:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"inv":"001"}' http://127.0.0.1:8080/function/s3-roundtrip
{"put":true,"get":true,"list":1,"denied":false,"granted":true}
$ curl -s -X POST -H 'content-type: application/json' -d '{"inv":"002"}' http://127.0.0.1:8080/function/s3-roundtrip
{"put":true,"get":true,"list":2,"denied":false,"granted":true}
```

Each field of the response reports one step of the handler: `put` is `true` once the write into `gold` succeeded,
`get` is `true` when the object came back unchanged, and `list` counts the objects under `gold`, or is 0 when the new
object is not among them. The second response's `"list":2` shows that `gold` still holds the first call's object.
`denied` is `true` when the gateway refused a write into the prefix `other`, which the Function neither owns nor binds,
and `granted` is `true` when an object written into the prefix `shared`, through a role, came back unchanged.

`"denied":false` holds only under `funcdctl dev`, which gives each Function of the folder a role that allows writing
every prefix of the namespace's Buckets. On a platform, the gateway refuses the write into `other` with the S3 error
`AccessDenied`, and the response contains `"denied":true`. `"granted":true` holds on a platform as well, through the
RolesAssignment that [Access](#access) shows. [Run it locally](#run-it-locally) lists the other differences.

Press Ctrl-C in the first terminal to stop the example.

The Bucket `lakehouse` is a resource of its own, in `bucket.yaml`. Its prefix `gold` names the Function `s3-roundtrip`
as its **owner**, which can write the prefix. Its prefixes `other` and `shared` have no owner, and its prefixes `bi`
and `docs` hold the files of two Sites that this page does not use:

```yaml
# The lakehouse Bucket. A prefix's owner writes it without a role, and a binding lets a Function read it. Apply it
# before or after the Function, which waits for it.
apiVersion: funcd.io/v1alpha1
kind: Bucket
metadata:
  name: lakehouse
  namespace: default
  resourceGroup: rg1
spec:
  prefixes:
    - name: gold            # owned by s3-roundtrip
      owner:
        kind: Function
        name: s3-roundtrip
    - name: other           # no owner, not bound: a platform refuses the write with 403; funcdctl dev allows it
    - name: shared          # no owner: written through the role in rolesassignment.yaml
    - name: bi              # the bi Site's files; no owner
    - name: docs            # the docs Site's files; no owner
  quota:
    maxObjectBytes: 1073741824   # per-object cap (1 GiB)
```

The Function `s3-roundtrip`, in `function.yaml`, declares the Bucket by `ref` under
[`spec.buckets`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecbuckets): a binding can name only a Bucket that its
Function declares. Its binding under
[`spec.bindings.blob`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecbindingsblob) connects the prefix `gold` under the
alias `gold`. The binding lets the Function read the prefix, and the ownership lets it write the prefix. Over S3, the
handler does not use the alias: it names the Bucket and the object's key, whose first segment is the prefix, as in
`gold/roundtrip-001.txt`. `ctx.blob` takes the alias instead.

```yaml
# s3-roundtrip binds the prefix gold of the Bucket lakehouse, which it declares by ref, and waits until the prefix
# exists. The binding lets it read gold; as gold's owner, it also writes gold. While the S3 gateway runs, each worker
# gets AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: s3-roundtrip
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:s3-roundtrip   # what funcdctl push wrote from s3-roundtrip.mjs
  replicas: 1
  scaling:
    minReplicas: 1
  buckets:
    - ref: lakehouse            # shared with the bi and docs Sites (bucket.yaml)
  bindings:
    blob:
      - alias: gold           # the name ctx.blob takes
        bucket: lakehouse     # the Bucket
        prefix: gold          # the prefix it owns: it reads and writes it
```

The folder also holds the RolesAssignment that [Access](#access) shows, and a Workflow, an EventSource, a Sensor and
two Sites that this page does not use; `funcdctl dev` applies them all. It skips `funcdconfig.yaml`, a configuration
of the funcd server, which the example uses on a platform to turn the S3 gateway on.

The handler creates an S3 client from the AWS variables and runs the steps that the response reports:

```ts
// s3-roundtrip: an S3 client built from the AWS_* variables that funcd gives the worker. On each call the handler:
//   (a) PutObject  lakehouse/gold/roundtrip-<inv>.txt   — gold is the prefix it owns → allowed
//   (b) GetObject  it back                              — the body must match
//   (c) ListObjectsV2 prefix lakehouse/gold/            — the key must be present
//   (d) PutObject  lakehouse/other/x.txt                — refused with 403 on a platform; funcdctl dev allows it
//   (e) PutObject + GetObject  lakehouse/shared/granted-<inv>.txt — allowed by the role in rolesassignment.yaml
// It returns one field per step: put, get, list (the number of keys under gold/, or 0 without the new key), denied
// (true when (d) was refused) and granted (true when (e) read back what it wrote).
import type { CloudEvent, FunctionContext } from '@funcd-dev/shim';

import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';

export interface FuncInput {
  /** Optional invocation tag woven into the object key (defaults to a timestamp). */
  inv?: string;
}
export interface FuncOutput {
  put: boolean;
  get: boolean;
  list: number;
  denied: boolean;
  /** true when the object written into shared, a prefix it neither owns nor binds, reads back unchanged: the role in
   *  rolesassignment.yaml allows the write and the read. */
  granted: boolean;
}

const BUCKET = 'lakehouse';
const GOLD = 'gold'; // the prefix this function owns
const OTHER = 'other'; // not owned, not bound: a platform refuses the write
const SHARED = 'shared'; // not owned, not bound: written through the role in rolesassignment.yaml

function newClient(): S3Client {
  return new S3Client({
    region: process.env.AWS_REGION,
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
    // The gateway refuses the SDK's default streaming checksum trailer, so the client sends and checks a checksum
    // only when an operation requires one.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
}

async function streamToString(body: unknown): Promise<string> {
  // In Node the GetObject Body is a Readable stream; transformToString is the SDK helper.
  const b = body as { transformToString?: () => Promise<string> } | undefined;
  if (b?.transformToString) {
    return b.transformToString();
  }
  return '';
}

export async function handle(ctx: FunctionContext, event: CloudEvent<FuncInput>): Promise<FuncOutput> {
  const inv = event.data?.inv ?? String(Date.now());
  const key = `${GOLD}/roundtrip-${inv}.txt`;
  const want = `roundtrip-${inv}`;
  const s3 = newClient();

  // (a) PutObject into gold, the prefix it owns → allowed.
  await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: want }));
  ctx.log(`s3-roundtrip: PUT ${BUCKET}/${key} ok`);
  const put = true;

  // (b) GetObject it back → body must match.
  const got = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
  const body = await streamToString(got.Body);
  const get = body === want;
  ctx.log(`s3-roundtrip: GET ${BUCKET}/${key} → match=${get}`);

  // (c) ListObjectsV2 the gold prefix → the key must be present.
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: BUCKET, Prefix: `${GOLD}/` }));
  const keys = (listed.Contents ?? []).map((o) => o.Key);
  const list = keys.includes(key) ? keys.length : 0;
  ctx.log(`s3-roundtrip: LIST ${GOLD}/ → ${keys.length} object(s), present=${keys.includes(key)}`);

  // (d) PutObject into other, which it neither owns nor binds → 403 on a platform; funcdctl dev allows it.
  let denied = false;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: `${OTHER}/x.txt`, Body: 'nope' }));
    ctx.log(`s3-roundtrip: PUT ${OTHER}/x.txt allowed (denied=false)`);
  } catch (err) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
    const code = e?.$metadata?.httpStatusCode;
    denied = code === 403 || e?.name === 'AccessDenied';
    ctx.log(`s3-roundtrip: PUT ${OTHER}/x.txt denied=${denied} (status=${code}, name=${e?.name})`);
  }

  // (e) PutObject + GetObject into shared, which it neither owns nor binds → allowed by the role in
  //     rolesassignment.yaml.
  let granted = false;
  try {
    const gkey = `${SHARED}/granted-${inv}.txt`;
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: gkey, Body: want }));
    const g = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: gkey }));
    granted = (await streamToString(g.Body)) === want;
    ctx.log(`s3-roundtrip: PUT+GET ${gkey} via RolesAssignment grant → granted=${granted}`);
  } catch (err) {
    const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
    ctx.log(`s3-roundtrip: ${SHARED} write via grant FAILED (status=${e?.$metadata?.httpStatusCode}, name=${e?.name})`);
  }

  return { put, get, list, denied, granted };
}
```

## Use ctx.blob instead of an S3 client

`ctx.blob`, in TypeScript and in Python, reaches the prefixes that the handler's Function binds. It needs no S3 client,
no key pair and no S3 gateway, which a platform runs only when its operator turns it on, so it suits a handler that
reads and writes only the prefixes that it binds. An S3 client suits code or tools that already speak S3, a read
through a role instead of a binding, and an object larger than a `ctx.blob` write can carry, as
[Limits and quotas](#limits-and-quotas) says.

Each method of `ctx.blob` takes the alias of a binding as its first argument, and the keys that it takes and returns
are relative to the bound prefix: under the alias `gold` of the first example, the key `roundtrip-001.txt` names the
object that the S3 gateway shows as `gold/roundtrip-001.txt`. The [Handler API](https://pyvvo.github.io/funcd/docs/develop/services/bucket/spec.md#handler-api) on the Spec tab lists the methods of `ctx.blob` in
each language.

## Share a Bucket between Functions

Create the Bucket as a resource of its own, and set the `owner` of each prefix to the Function that writes the prefix:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Bucket
metadata:
  name: media
  namespace: default
  resourceGroup: rg1
spec:
  quota:
    maxSize: 1Gi
  prefixes:
    - name: uploads
      owner:
        kind: Function
        name: ingest
    - name: thumbnails
      owner:
        kind: Function
        name: resize
```

Each Function that uses the Bucket declares it by `ref` under `spec.buckets` and binds each prefix that it reaches. In
this excerpt of the
[complete example](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/bucket/bucket.yaml), the
Function `resize` reads the prefix `uploads`, which the Function `ingest` owns, and writes the prefix `thumbnails`,
which `resize` owns:

```yaml
spec:
  buckets:
    - ref: media
  bindings:
    blob:
      - alias: uploads
        bucket: media
        prefix: uploads
      - alias: thumbnails
        bucket: media
        prefix: thumbnails
```

While a binding names a Bucket or a prefix that does not exist yet, funcd holds the Function in `Pending` with the
reason `BucketNotFound`, and starts it once the prefix exists, so a Bucket and its Functions can be applied in any
order.

A Function other than the owner needs a role to write a prefix, as [Access](#access) explains, and a prefix of a
Bucket applied on its own that sets no `owner` is written only through such a role.

A Function can also declare a Bucket by `name` under `spec.buckets`. funcd then creates the Bucket, and each of its
prefixes that sets no `owner` gets that Function as its owner. [Changes and deletion](#changes-and-deletion) says what
happens to such a Bucket when the Function is deleted.

## Access

A Function needs no role for these [actions](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#choose-a-role), through
`ctx.blob` and through the S3 gateway alike:

- **Read the prefixes that it binds** (`s3::read`). Each entry of `spec.bindings.blob` lets the Function read that
  prefix, never write it.
- **Write the prefixes that it owns** (`s3::write`).

Any other write needs a role, and a read of a prefix that the principal does not bind needs a role or a permit in a
Policy that an operator writes. A RolesAssignment gives a principal a role on one prefix or on the whole namespace. The
principal is a Function, or an [Identity](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security/spec.md#identityspec): a client
outside funcd, which reaches the Buckets through the S3 gateway with the key pair that funcd writes into the Identity's
Secret.

The smallest built-in role that allows writing is `Blob Data Writer`, which allows reading and writing objects. Its
scope has the kind `BucketPrefix` and the name `<bucket>/<prefix>`. No scope covers one Bucket as a whole: a
RolesAssignment names each prefix in an entry of its own, or covers the whole namespace with the scope kind
`Namespace`. The first example's folder holds this RolesAssignment, which gives `s3-roundtrip` write access to the
prefix `shared` of the Bucket `lakehouse`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: s3-roundtrip-shared-writer
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Function
    name: s3-roundtrip
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: Blob Data Writer
      scope:
        kind: BucketPrefix
        name: lakehouse/shared
```

For a read without a binding, the smallest built-in role is `Blob Data Reader`, which allows reading objects. A
Function makes such a read through the S3 gateway, since `ctx.blob` reaches only the prefixes that the Function binds.
That read needs the gateway on, and a key pair, which funcd gives only to a Function that binds at least one prefix.
The built-in role `Reader` also allows reading objects, and `Contributor` and `Owner` allow reading and writing them;
all three cover KV keys too. A Role that an operator defines can grant `s3::read` or `s3::write` as well. The Security
reference [lists the built-in roles](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignmentsroleref)
and [explains how assignments pair each role with a scope](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignments).

funcd applies these rules as a built-in policy in every namespace, so nothing needs to be written or installed. A
[Policy](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#write-a-policy) that an operator writes applies beside it:
it can permit a read, but it cannot allow a write that the built-in policy forbids. In Cedar, the built-in policy
reads:

```cedar title="Built-in Bucket policy"
@id("s3-read-binding")
permit(principal, action == Action::"s3::read", resource)
  when { principal has blobBindings && principal.blobBindings.contains(resource) };

@id("s3-write-base")
permit(principal, action == Action::"s3::write", resource);

@id("s3-single-writer")
forbid(principal, action == Action::"s3::write", resource)
  unless { resource has writers && resource.writers.contains(principal) };
```

`ctx.blob` refuses a call whose alias no binding of its Function declares. A request that the policy denies fails
with the HTTP status 403: through `ctx.blob`, its message names the rule, such as
`cedar: forbidden by policy builtin/s3-single-writer`; through the S3 gateway, its error code is `AccessDenied`. A
write by a principal that neither owns the prefix nor holds a writer role meets that rule: give the principal a writer
role, as above.

## Limits and quotas

A Bucket's [`spec.quota`](https://pyvvo.github.io/funcd/docs/develop/services/bucket/spec.md#bucketspecquota) and the [`quota`](https://pyvvo.github.io/funcd/docs/develop/services/bucket/spec.md#bucketspecprefixesquota) of each of its
prefixes set its limits:

- `maxSize` or `maxBytes` limits the total size of the Bucket, or of one prefix. Set one of the two, not both. Without
  either, there is no size limit. A write into a prefix must fit both the prefix's limit and the Bucket's.
- `maxObjectBytes`, on the Bucket only, limits the size of each object. When it is 0 or not set, the Bucket sets no
  such limit of its own.

A write fails when its object is larger than `maxObjectBytes`, or when it would take the Bucket or the prefix above its
total size.

funcd also sets limits of its own, whatever the Bucket sets:

- A `put` through `ctx.blob` carries at most 64 MiB.
- The S3 gateway takes at most 1 GiB in one PUT or multipart upload, a limit that the operator changes with
  `s3gateway.maxUploadBytes`. The parts of the multipart uploads in flight hold at most that size for one principal,
  and twice that size in all; with the copies that completing uploads assemble, at most three times that size. Past
  those limits, a part, or a Complete whose copy does not fit, gets the S3 error `SlowDown`, which asks the client to
  retry.
- funcd keeps free space on the filesystem of its data directory: 2 GiB, unless `storage.minFreeSize` sets another
  size. A write into any Bucket, with or without a quota, fails when it would take the free space below that size.
  `storage.minFreeSize: 0` turns this limit off, and it does not apply under `storage.mode: memory`.
- A namespace holds at most 100 Buckets.

The [Spec](https://pyvvo.github.io/funcd/docs/develop/services/bucket/spec.md) tab gives the range of each field.

## Data storage

funcd keeps the objects of every Bucket in its blob store. By default, the blob store is the `blob` folder of funcd's
data directory, `storage.dataDir`, and the objects survive a restart. `blob.dir` names another folder. `blob.target`
keeps the objects in a versioned S3-compatible bucket instead, and funcd refuses to start when that bucket keeps no
versions, unless `blob.allowUnversioned` is `true`. `storage.mode: memory` keeps the objects in memory, where they are
lost when funcd stops, and funcd then ignores the `blob` keys. These keys are in
[funcd's configuration](https://pyvvo.github.io/funcd/docs/develop/running-funcd/spec.md#funcdconfigyaml).

## Status

`funcdctl get bucket lakehouse -n default -o json` prints the status of the first example's Bucket, and
`funcdctl get function s3-roundtrip -n default -o json` that of its Function. With `funcdctl dev`, add the `--server`
and `--token` flags that its banner prints.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| Bucket `Ready` | | funcd's blob store answers. |
| Bucket `Degraded` | `StorageUnreachable` | funcd's blob store did not answer its last check, which funcd repeats every `health.storageProbeInterval`, 10 seconds by default. The message of the `Ready` condition gives the error. The Bucket becomes `Ready` again by itself once a check passes. |
| Function `Pending` | `BucketNotFound` | A Bucket or a prefix that the Function binds does not exist. The Function starts once it exists. |
| Function `Pending` | `StoreNotOwned` | A Bucket that the Function declares by `name` exists and is not the Function's, as [Changes and deletion](#changes-and-deletion) describes. |
| Any other reason | | See the [Function's Status](https://pyvvo.github.io/funcd/docs/develop/workloads/function.md#status). |

## Changes and deletion

- funcd refuses a request to delete a Bucket while a binding names it or while one of its prefixes holds objects. It
  refuses in the same way an update that removes a prefix that a binding names or that holds objects. Remove those
  bindings and delete those objects first.
- A Function that declares the Bucket by `ref` leaves the Bucket unchanged when it is deleted.
- When a Function that declares the Bucket by `name` is deleted, the `deletion` setting of its entry under
  `spec.buckets` decides: `retain`, the default, keeps the Bucket and its objects, and `delete` deletes them. Unlike a
  request to delete the Bucket, this deletion goes ahead while the prefixes hold objects.
- To use a Bucket that stayed, declare it by `ref` in the new Function. A new Function of the same name that declares
  the Bucket by `name` waits in `Pending` with the reason `StoreNotOwned`, since the Bucket still belongs to the
  deleted Function. The owner of a prefix is a name, so a new Function of the same name, under `ref`, can write again
  the prefixes that name it as their owner.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local setup errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no build of "<name>"` | Build the Function, or name its build after it, where the [Function page](https://pyvvo.github.io/funcd/docs/develop/workloads/function.md#run-it-locally) says that `funcdctl dev` looks. The message names the paths that it looked at. |

## Run it locally

`funcdctl dev` keeps the objects in memory, whatever [Data storage](#data-storage) says about a server, so they are
lost when `funcdctl dev` stops. With `--persist`, it keeps them between runs, in the `blob` folder of `.funcd-dev` in
the current directory, or of the folder that `--persist-to` names. Deleting that folder after `funcdctl dev` stops
clears all the state that the local platform stored: its resources and its KV, blob, SQL, lake and volume data.

`funcdctl dev` also differs from a platform in these ways that matter for a Bucket:

- It always runs the S3 gateway, on a free port that it chooses, or on the port that `--s3port` sets. Its banner
  prints the gateway's address and, under S3 CREDENTIALS, the key pair of the folder's first Function, as `export`
  lines. An S3 client that runs with those variables, such as the aws CLI, acts as that Function: it reads the
  prefixes that the Function binds and, through the role that the next item describes, writes every prefix.
  `funcdctl dev <dir> --s3port <port> --print-env` prints the same lines without starting the platform, for a session
  started with the same `--s3port`.
- It gives each Function of the folder a role that allows writing every prefix of the namespace's Buckets, so a write
  that succeeds locally can be denied once deployed, as the first example's `denied` shows. That role allows no read:
  reading still needs a binding, a role or a Policy permit.

The [reference of `funcdctl dev`](https://pyvvo.github.io/funcd/docs/develop/tools/funcdctl/spec.md#funcdctl-dev) lists its flags.

## Examples

- [s3-roundtrip in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/s3-roundtrip): objects
  written and read with the AWS SDK through the S3 gateway, a write that the policy refuses on a platform, and a write
  that a role allows.
