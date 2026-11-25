# Bucket

Source: https://funcd.dev/docs/develop/services/bucket.md (the Markdown copy of the page; prefer it when the network is up).

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

A [Bucket](https://funcd.dev/docs/platform/services/bucket.md) holds objects under **prefixes**. A Function reaches a prefix through
a **binding**, and reads and writes its objects with an S3 client, through funcd's **S3 gateway**, or through
[`ctx.blob`](#use-ctxblob-instead-of-an-s3-client).

Install the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git and curl, and put Node.js on the `PATH`. The
TypeScript example s3-roundtrip writes, reads and lists objects with the AWS SDK, already bundled in its build.

While the S3 gateway runs, each worker of a Function that binds a prefix gets the gateway's address and a key pair of
its own in the standard AWS variables. `funcdctl dev` always runs the gateway; a platform runs it only with
[`s3gateway.enabled: true`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml).

### TypeScript

Clone the repository and start the example:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/s3-roundtrip --gport 8080
```

In another terminal, call the Function twice:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"inv":"001"}' http://127.0.0.1:8080/function/s3-roundtrip
{"put":true,"get":true,"list":1,"denied":false,"granted":true}
$ curl -s -X POST -H 'content-type: application/json' -d '{"inv":"002"}' http://127.0.0.1:8080/function/s3-roundtrip
{"put":true,"get":true,"list":2,"denied":false,"granted":true}
```

`denied` reports a write into a prefix that the Function neither owns nor binds, and `granted` a write that a role
allows. On a platform, the first one gets `AccessDenied` and `"denied":true`; under `funcdctl dev` it succeeds, since
[every Function may write every prefix there](#run-it-locally). Press Ctrl-C in the first terminal to stop.

The Bucket, in `bucket.yaml`. A prefix's **owner**, here `s3-roundtrip` for `gold`, can write it:

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

The Function, in `function.yaml`, declares the Bucket under
[`spec.buckets`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbuckets) and binds `gold` under
[`spec.bindings.blob`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindingsblob): the binding allows reading, the
ownership writing. Over S3, the handler names the Bucket and the full key, such as `gold/roundtrip-001.txt`:

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

The handler:

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

[`ctx.blob`](https://funcd.dev/docs/develop/services/bucket/spec.md#handler-api), in TypeScript and Python, reaches the prefixes that the Function binds, with no S3
client, key pair or gateway. Its methods take the binding's alias and keys relative to the prefix: under the alias
`gold`, `roundtrip-001.txt` is the S3 object `gold/roundtrip-001.txt`. Use an S3 client for code that already speaks
S3, for a read through a role, or for an object over the `ctx.blob` [limit](#limits-and-quotas).

## Share a Bucket between Functions

Create the Bucket on its own, with the `owner` of each prefix:

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

Each Function declares it by `ref` and binds the prefixes that it reaches, as in this excerpt of the
[complete example](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/bucket/bucket.yaml):

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

A Function that binds a missing Bucket or prefix waits in `Pending` with `BucketNotFound`, so the resources can be
applied in any order. When a Function declares a Bucket by `name`, funcd creates the Bucket, and the Function owns
each prefix that names no owner.

## Access

- A Function reads the prefixes that it binds (`s3::read`) and writes those that it owns (`s3::write`) with no
  [role](https://funcd.dev/docs/develop/security-and-networking/security.md#choose-a-role). Any other write needs a role, and a read of an
  unbound prefix a role or a Policy permit.
- The principal is a Function or an [Identity](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#identityspec), a client
  outside funcd with the key pair that funcd writes into the Identity's Secret.
- The smallest writer role is
  [`Blob Data Writer`](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignmentsroleref), scoped to
  `BucketPrefix` `<bucket>/<prefix>` or to the `Namespace`; no scope covers one whole Bucket. `Blob Data Reader`
  allows a read without a binding, through the S3 gateway with the key pair of a Function that binds some prefix.
  `Reader` also reads objects, and `Contributor` and `Owner` read and write them; all three cover KV keys too.

The first example's RolesAssignment lets `s3-roundtrip` write the prefix `shared`:

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

funcd applies these rules as a built-in policy in every namespace. An operator's
[Policy](https://funcd.dev/docs/develop/security-and-networking/security.md#write-a-policy) can permit a read, but never a write that it
forbids:

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

A denied request fails with the HTTP status 403: through `ctx.blob`, its message names the rule, such as
`cedar: forbidden by policy builtin/s3-single-writer`; through the S3 gateway, its code is `AccessDenied`.

## Limits and quotas

- A Bucket's [`spec.quota`](https://funcd.dev/docs/develop/services/bucket/spec.md#bucketspecquota) and each prefix's [`quota`](https://funcd.dev/docs/develop/services/bucket/spec.md#bucketspecprefixesquota) cap
  its size with `maxSize` or `maxBytes`, and the Bucket's `maxObjectBytes` caps each object. A write must fit both the
  prefix's cap and the Bucket's.
- A `ctx.blob` `put` carries at most 64 MiB. The S3 gateway takes at most
  [`s3gateway.maxUploadBytes`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml), 1 GiB by default, per upload; the
  multipart uploads in flight hold at most that for one principal and twice that in all, and past that a part gets
  `SlowDown`, which asks the client to retry.
- A write fails when it would leave less than `storage.minFreeSize`, 2 GiB by default, free on the data directory's
  filesystem.
- A namespace holds at most 100 Buckets.

## Data storage

funcd keeps the objects in its blob store, by default the `blob` folder of `storage.dataDir`, where they survive a
restart; [`blob.target`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml) keeps them in a versioned S3-compatible bucket
instead. With `storage.mode: memory`, they are lost when funcd stops.

## Status

`funcdctl get bucket lakehouse -n default -o json` and `funcdctl get function s3-roundtrip -n default -o json` print
the status; with `funcdctl dev`, add the `--server` and `--token` flags of its banner.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| Bucket `Ready` | | funcd's blob store answers. |
| Bucket `Degraded` | `StorageUnreachable` | funcd's blob store did not answer its last check, which funcd repeats every `health.storageProbeInterval`, 10 seconds by default. The message of the `Ready` condition gives the error. The Bucket becomes `Ready` again by itself once a check passes. |
| Function `Pending` | `BucketNotFound` | A Bucket or a prefix that the Function binds does not exist. The Function starts once it exists. |
| Function `Pending` | `StoreNotOwned` | A Bucket that the Function declares by `name` exists and is not the Function's, as [Changes and deletion](#changes-and-deletion) describes. |
| Any other reason | | See the [Function's Status](https://funcd.dev/docs/develop/workloads/function.md#status). |

## Changes and deletion

- funcd refuses to delete a Bucket, or to remove a prefix, while a binding names it or it holds objects.
- When a Function that declares the Bucket by `name` is deleted, its entry's `deletion` decides: `retain`, the
  default, keeps the Bucket and its objects, and `delete` deletes them.
- A Bucket that stayed belongs to the deleted Function: a new Function of the same name declares it by `ref`, or waits
  with `StoreNotOwned`. A prefix's owner names a kind and a name, never a UID, so that new Function can write its prefixes again.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local setup errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no build of "<name>"` | Build the Function, or name its build after it, where the [Function page](https://funcd.dev/docs/develop/workloads/function.md#run-it-locally) says that `funcdctl dev` looks. The message names the paths that it looked at. |

## Run it locally

- `funcdctl dev` keeps the objects in memory, or with
  [`--persist`](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-dev) in `.funcd-dev/blob`.
- It runs the S3 gateway on a free port, or on `--s3port`, and its banner prints the first Function's key pair as
  `export` lines, so a client such as the aws CLI acts as that Function; `--print-env` prints them without starting.
- It lets every Function write every prefix, so a write that succeeds locally can be denied once deployed. Reads still
  need a binding, a role or a Policy permit.

## Examples

- [s3-roundtrip in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/s3-roundtrip): objects
  through the S3 gateway, a refused write and a write that a role allows.
