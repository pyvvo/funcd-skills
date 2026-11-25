# KV

Source: https://funcd.dev/docs/develop/services/kv.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Write a key only while a condition holds
- Hold a claim on a key
- Share a store between Functions
- Access
- Limits and quotas
- Data storage
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Declare a key-value store, bind its tables to a Function, and read and write keys from the handler.

## Usage

A KV store keeps keys and their values in tables, each a separate set of keys inside the store. A Function's handler
reads and writes the keys through `ctx.kv`, the KV client of the context that every handler receives. See
[how KV works](https://funcd.dev/docs/platform/services/kv.md) for the concept.

The kv-counter example counts calls by name: each call sends a name, and the Function adds one to the count stored
under that name and returns the new count.

Install the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git and curl, and put the runtime of the
example's language on the `PATH`: Node.js for TypeScript, or Python 3.12 or later as `python3`.

The example's Function declares a store under [`spec.kv`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspeckv), with one
table. The table sets no `owner`, so the Function that declares the store owns the table and can write it;
[Access](#access) explains who else can. A **binding** under
[`spec.bindings.kv`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindingskv) connects the table to the Function under
an alias, which the handler passes to `ctx.kv`. The [Spec](https://funcd.dev/docs/develop/services/kv/spec.md) tab lists every field of a store and every method
of [`ctx.kv`](https://funcd.dev/docs/develop/services/kv/spec.md#ctxkv).

`funcdctl dev` starts a local platform, runs the resource files of one folder on it, and prints the URL of each
Function, on the port that `--gport` sets. It runs the Function from the code in the folder, not from the manifest's
`image`, the bundle that `funcdctl push` writes for a platform to run.

### TypeScript

The Function `counter` binds its table with the alias `counters`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: counter
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:counter   # what funcdctl push wrote from counter.mjs
  replicas: 1
  scaling:
    minReplicas: 1
  kv:
    - name: counters-kv         # the KVStore that this Function owns
      tables:
        - name: table-counters  # its table, which this Function alone writes
  bindings:
    kv:
      - alias: counters         # the name that the handler passes to ctx.kv
        store: counters-kv
        table: table-counters
```

Its handler reads the count with `getText`, adds one, and writes it with `put`:

```ts
import type { CloudEvent, FunctionContext } from '@funcd-dev/shim';

export interface FuncInput {
  name?: string;
}
export interface FuncOutput {
  name: string;
  count: number;
}

export async function handle(ctx: FunctionContext, event: CloudEvent<FuncInput>): Promise<FuncOutput> {
  const name = event.data?.name ?? 'world';
  const cur = await ctx.kv.getText('counters', name);
  const count = Number(cur ?? 0) + 1;
  await ctx.kv.put('counters', name, String(count));
  ctx.log(`kv-counter: ${name} → ${count}`);
  return { name, count };
}
```

Clone the repository and start the example from its root folder:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/kv-counter --gport 8080
```

In another terminal, call the Function twice with the same name:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"ada"}' http://127.0.0.1:8080/function/counter
{"name":"ada","count":1}
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"ada"}' http://127.0.0.1:8080/function/counter
{"name":"ada","count":2}
```

Press Ctrl-C in the first terminal to stop the example.

### Python

The Function `pycounter` binds its table with the alias `pycounters`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: pycounter
  namespace: default
  resourceGroup: rg1
spec:
  runtime: python314
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:pycounter   # what funcdctl push wrote from the handler
  replicas: 1
  scaling:
    minReplicas: 1
  kv:
    - name: py-counters         # the KVStore that this Function owns
      tables:
        - name: table-counters  # its table, which this Function alone writes
  bindings:
    kv:
      - alias: pycounters       # the name that the handler passes to context.kv
        store: py-counters
        table: table-counters
```

Its handler reads the count with `get_str`, adds one, and writes it with `put`:

```py
from typing import TypedDict

from funcd_shim import CloudEvent, FunctionContext


class FuncInput(TypedDict):
    """The event payload — a closed record carrying the counter name to increment."""

    name: str


class FuncOutput(TypedDict):
    """The 200 body — the name and its new count."""

    name: str
    count: int


def handle(context: FunctionContext, event: CloudEvent[FuncInput]) -> FuncOutput:
    """Increment the per-name counter via the ``pycounters`` KV binding and return it."""
    # funcd checked event["data"] against FuncInput (422 otherwise), so it is present here.
    assert "data" in event
    name = event["data"]["name"]
    count = int(context.kv.get_str("pycounters", name) or 0) + 1
    context.kv.put("pycounters", name, str(count))
    context.log("kv-counter", name, count)
    return {"name": name, "count": count}


```

Clone the repository and start the example from its root folder:

```console
$ git clone https://github.com/pyvvo/funcd-python
$ cd funcd-python
$ funcdctl dev examples/kv-counter --gport 8080
```

In another terminal, call the Function twice with the same name:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"ada"}' http://127.0.0.1:8080/function/pycounter
{"name":"ada","count":1}
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"ada"}' http://127.0.0.1:8080/function/pycounter
{"name":"ada","count":2}
```

Press Ctrl-C in the first terminal to stop the example.

## Write a key only while a condition holds

When two kv-counter calls for the same name run at the same moment, both can read the same count and write the same
new count, so one increment is lost. A conditional write lets the handler detect that another caller changed the key
first: it changes the key only while its condition holds, and its result tells the caller whether the write happened:

- `putIfAbsent` (`put_if_absent` in Python) creates a key only when the key does not exist; a key that has expired
  counts as absent. It returns the key's new version, or `null` (`None` in Python) when the key exists.
- `compareAndSet` (`compare_and_set`) replaces a key only when the key still has a given version, which `getEntry`
  (`get_entry`) returns with the key's value. It returns the key's new version, or `null` (`None`) when the key does
  not have that version.
- `delIf` (`delete_if`) deletes a key only when the key still has a given version. It returns `true` (`True`), or
  `false` (`False`) when the key does not have that version.

When several callers create the same absent key at the same moment, exactly one `putIfAbsent` succeeds. When several
callers replace or delete the same key with the same version, exactly one `compareAndSet` or `delIf` succeeds. A
caller whose write failed has not changed the key: to keep its update, it reads the key again, with the key's new
version, and retries.

## Hold a claim on a key

A claim is a key that one caller holds until that caller releases the key or the key expires. The kv-claim example
holds claims with conditional writes. Each call sends a `key`, a `holder` that names the caller, and an `op`:

- `claim` creates the key with `putIfAbsent`.
- `renew` replaces the key with `compareAndSet`, using the `version` that the holder received when it won.
- `release` deletes the key with `delIf`, using that `version`.

A call that wins returns a response with `"won":true` and the key's new version; after a release, the version and the
holder are empty. A call that loses returns a response with `"won":false` and the key's current version and holder,
which are empty when the key no longer exists.

A write with a `ttl`, a number of whole seconds, makes the key expire after that time, and a write without a `ttl`
leaves the key with no expiry. A holder keeps its claim by renewing it with a new `ttl` before the claim expires.

The TypeScript Function `claim` declares the store `claims-kv` and owns its table `claims`. The Python Function
`pyclaim` writes the same table through a writer role, which [Access](#access) shows, so both Functions compete for the
same claims. The excerpts below show only the conditional write of each handler; they do not run on their own.

### TypeScript

In this excerpt, `opts` holds the call's `ttl` as `{ ttl }`, or is `undefined` when the call sends no `ttl`. The
complete handler is
[examples/kv-claim/src/main.ts](https://github.com/pyvvo/funcd-typescript/blob/main/examples/kv-claim/src/main.ts).

```ts
const v =
  op === 'renew'
    ? await ctx.kv.compareAndSet('claims', key, holder, version, opts)
    : await ctx.kv.putIfAbsent('claims', key, holder, opts);
if (v !== null) return { key, won: true, version: v, holder };
```

### Python

In this excerpt, `kv` is `context.kv`, and `ttl` is the call's `ttl`, or `None` when the call sends none. The complete
handler is
[examples/kv-claim/src/main.py](https://github.com/pyvvo/funcd-python/blob/main/examples/kv-claim/src/main.py).

```py
new = (
    kv.compare_and_set("claims", key, holder, version, ttl=ttl)
    if op == "renew"
    else kv.put_if_absent("claims", key, holder, ttl=ttl)
)
if new is not None:
    return {"key": key, "won": True, "version": new, "holder": holder}
```

## Share a store between Functions

Create the store as a separate KVStore, and set the `owner` of each table to the Function or Job that writes the table, by
its kind and name:

```yaml
apiVersion: funcd.io/v1alpha1
kind: KVStore
metadata:
  name: counters-kv
  namespace: default
  resourceGroup: rg1
spec:
  quota:
    maxSize: 64Mi
  tables:
    - name: table-counters
      owner:
        kind: Function
        name: counter
```

Each Function that uses the store declares it by `ref` under `spec.kv` and binds the table, as this excerpt of the
Function `counter`, from the
[complete example](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/kv/kvstore.yaml), shows:

```yaml
spec:
  kv:
    - ref: counters-kv
  bindings:
    kv:
      - alias: counters
        store: counters-kv
        table: table-counters
```

Every Function that binds the table can read it. A Function other than the owner needs a role to write it, as
[Access](#access) explains, and a table of a KVStore that sets no `owner` is written only through such a role.

## Access

A Function needs no role for these [actions](https://funcd.dev/docs/develop/security-and-networking/security.md#choose-a-role):

- **Read the tables that it binds** (`kv::read`). Each entry of `spec.bindings.kv` lets the Function read that table,
  never write it.
- **Write the tables that it owns** (`kv::write`).

Any other write needs a role. A RolesAssignment gives a Function a role on one table, on a store, or on the whole
namespace. The smallest built-in role that allows writing is `KV Data Writer`, which allows reading and writing
keys. Its scope names one table as `<store>/<table>`, or a store as `<store>`. The kv-claim example gives `pyclaim`
write access to the table `claims` of the store `claims-kv`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: pyclaim-writes-claims
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Function
    name: pyclaim
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: KV Data Writer
      scope:
        kind: KVStore
        name: claims-kv/claims
```

The built-in roles `Contributor` and `Owner` also allow writing keys, together with reading and writing buckets, and a
Role that an operator defines can allow it too. The Security reference
[lists the built-in roles](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignmentsroleref) and
[explains how assignments pair each role with a scope](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignments).

funcd applies these rules as a built-in policy in every namespace, so nothing needs to be written or installed. A
[Policy](https://funcd.dev/docs/develop/security-and-networking/security.md#write-a-policy) that an operator writes applies beside it,
and cannot allow a write that the built-in policy forbids. In Cedar, the built-in policy reads:

```cedar title="Built-in KV policy"
@id("kv-read-binding")
permit(principal, action == Action::"kv::read", resource)
  when { principal has kvBindings && principal.kvBindings.contains(resource) };

@id("kv-write-base")
permit(principal, action == Action::"kv::write", resource);

@id("kv-single-writer")
forbid(principal, action == Action::"kv::write", resource)
  unless { resource has writers && resource.writers.contains(principal) };
```

A binding can name only a store that its own Function declares, by `name` or by `ref`. No role lets a Function read a
table that it does not bind: `ctx.kv` takes only a binding's alias, and no other client reaches KV keys. A call that
the policy denies fails with the HTTP status 403, and its message names the rule. A write by a Function that neither
owns the table nor holds a writer role fails with `cedar: forbidden by policy builtin/kv-single-writer`: give the
Function a writer role, as above.

## Limits and quotas

A store's [`spec.quota`](https://funcd.dev/docs/develop/services/kv/spec.md#kvstorespecquota) sets its limits:

- `maxSize` or `maxBytes` limits the total size of the store. Set one of the two, not both. Without either, the store
  has no size limit.
- `maxValueBytes` limits the size of each value. When it is not set, the limit is 1 MiB.
- `maxKeyBytes` limits the size of each key. When it is not set, the limit is 1 KiB.

A write fails when its key or its value is above its limit, or when it would take the store above its total size. The
[Spec](https://funcd.dev/docs/develop/services/kv/spec.md) tab gives the range of each field.

## Data storage

By default, funcd keeps KV data in memory, and the data is lost when funcd stops. To keep the data on disk, set
`kvstore.engine: badger` in [funcd's configuration](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml). funcd then stores
the data in the `kv` folder of its data directory, unless `kvstore.dataDir` names another folder.
`storage.mode: memory` keeps KV data in memory even when `kvstore.engine` is `badger`.

## Status

`funcdctl get kvstore counters-kv -n default -o json` prints the status of the TypeScript example's store, and
`funcdctl get function counter -n default -o json` that of its Function; in Python, they are `py-counters` and
`pycounter`. With `funcdctl dev`, add the `--server` and `--token` flags that its banner prints. A store's
`status.tables` counts the tables that it declares, and `status.bindings` the bindings that name it.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| KVStore `Ready` | | funcd's KV engine answers. |
| KVStore `Degraded` | `StorageUnreachable` | funcd's KV engine did not answer its last check, which funcd repeats every `health.storageProbeInterval`, 10 seconds by default. The message of the `Ready` condition gives the error. The store becomes `Ready` again by itself once a check passes. |
| Function `Pending` | `KVStoreNotFound` | A store or a table that the Function binds does not exist. The Function starts once it exists. |
| Function `Pending` | `StoreNotOwned` | A store that the Function declares by `name` exists and is not the Function's, as [Changes and deletion](#changes-and-deletion) describes. |
| Any other reason | | See the [Function's Status](https://funcd.dev/docs/develop/workloads/function.md#status). |

## Changes and deletion

- funcd refuses a request to delete a KVStore while a binding names it or while it holds keys. To delete the store,
  remove its bindings and delete its keys first.
- Removing a table from a store deletes the table's keys. funcd refuses to remove a table from a KVStore while a
  binding names the table, so remove those bindings first.
- When a Function that declares a store by `name` is deleted, the
  [`deletion`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspeckv) setting of its entry decides: `retain`, the default,
  keeps the store and its keys, and `delete` deletes them.
- To use a store that stayed, declare it by `ref` in the new Function. A new Function of the same name that declares
  the store by `name` waits in `Pending` with the reason `StoreNotOwned`, since the store still belongs to the deleted
  Function.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local setup errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no python interpreter found for the python handler` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `cannot load the runtime shim (needs Python ≥3.12; set FUNCD_PYTHON)` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |

## Run it locally

`funcdctl dev` keeps KV data in memory, whatever [Data storage](#data-storage) says about a server, so the data is
lost when `funcdctl dev` stops. With `--persist`, it keeps the KV data between runs, in the `kv` folder of
`.funcd-dev` in the current directory, or of the folder that `--persist-to` names. Deleting `.funcd-dev`, or the
`--persist-to` folder, after `funcdctl dev` stops clears all the state that the local platform stored: its resources
and its KV, blob, SQL, lake and volume data.

## Examples

- [kv-counter in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/kv-counter) and
  [in Python](https://github.com/pyvvo/funcd-python/tree/main/examples/kv-counter): a count for each name, kept in a
  KV store.
- [kv-claim in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/kv-claim) and
  [in Python](https://github.com/pyvvo/funcd-python/tree/main/examples/kv-claim): a claim on a key, held with
  conditional writes.
