# Secrets

Source: https://funcd.dev/docs/develop/services/secrets.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Write a key of a Secret
- Let another Function write a Secret
- Access
- Limits and quotas
- Data storage
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Create a Secret, bind it in a Function, read its values, and control which Functions can change its values.

## Usage

[Secrets](https://funcd.dev/docs/platform/services/secrets.md) store named values such as API keys. Declare and bind a Secret to a Function, then read its values through `ctx.secret`.

Install the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git, curl and Node.js.

### TypeScript

Run the [env-echo example](https://github.com/pyvvo/funcd-typescript/tree/main/examples/env-echo):

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call the Function:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"s3cr3t","shared":"from-secret"}
```

The example returns dummy Secret values for demonstration.

Encode a new value for `API_KEY`:

```console
$ printf '%s' rotated | base64
cm90YXRlZA==
```

In `examples/env-echo/secret.yaml`, replace `API_KEY`'s value with `cm90YXRlZA==`. Save, wait about a second, and call the Function again:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"rotated","shared":"from-secret"}
```

The updated value is available without restarting the worker. Press Ctrl-C in the first terminal to stop.

The Secret (`secret.yaml`):

```yaml
# app-secret: the values that env-echo reads through ctx.secret; none of them is in the worker's environment. Each
# value under data is in base64. SHARED is also a key of the ConfigMap app-config: because this bound Secret holds
# it, funcd leaves it out of the environment, and the handler reads the Secret's value.
apiVersion: funcd.io/v1alpha1
kind: Secret
metadata:
  name: app-secret
  namespace: default
  resourceGroup: rg1
spec:
  type: Opaque   # the only type; funcd does not read it
  data:
    API_KEY: czNjcjN0           # base64("s3cr3t")
    SHARED: ZnJvbS1zZWNyZXQ=    # base64("from-secret")
```

The Function:

```yaml
# env-echo: a Function that takes no input and returns one setting of the ConfigMap app-config and two values of
# the Secret app-secret. funcd puts the ConfigMap's keys in each worker's environment, except SHARED, a key of both;
# no Secret value is in the environment, so the handler reads the Secret through ctx.secret. No worker starts while
# the ConfigMap or the Secret is missing.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: env-echo
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:env-echo   # funcdctl push env-echo.mjs (built from src/main.ts)
  replicas: 1
  scaling:
    minReplicas: 1
  configMaps:
    - ref: app-config       # configmap.yaml
  secrets:
    - name: app-secret      # secret.yaml holds both keys
      keys:
        - API_KEY
        - SHARED
  bindings:
    config:
      - app-config    # its keys become environment variables, except SHARED, which app-secret also holds
    secret:
      - app-secret    # the handler reads its keys through ctx.secret, never from the environment
```

The handler (`src/main.ts`):

```ts
// env-echo: a handler that takes no input and returns three values: APP_MODE from its environment, where funcd puts
// the keys of the bound ConfigMap, and API_KEY and SHARED from the bound Secret, through ctx.secret.
import type { Handler } from '@funcd-dev/shim';

/** The function takes no input, so a call needs no body. */
export type FuncInput = void;

/** What the handler returns: config is APP_MODE from the ConfigMap; secret and shared are API_KEY and SHARED from
 *  the Secret. */
export interface FuncOutput {
  config: string;
  secret: string;
  shared: string;
}

// No Secret value is in the worker's environment: ctx.secret asks funcd for each value on each call. The ConfigMap's
// keys are in the environment, except SHARED, which the Secret also holds.
export const handle: Handler<FuncInput, FuncOutput> = async (ctx) => {
  return {
    config: process.env.APP_MODE ?? '',
    secret: (await ctx.secret.get('API_KEY')) ?? '',
    shared: (await ctx.secret.get('SHARED')) ?? '',
  };
};
```

See [Spec](https://funcd.dev/docs/develop/services/secrets/spec.md#handler-api) for method details.

## Write a key of a Secret

A Function can update a bound Secret if it owns the Secret or has the `Secret Data Writer` role. The secret-writer example writes, reads and deletes `TOKEN`.

Writes change keys in an existing Secret. They do not create or delete the Secret itself.

### TypeScript

If the repository has not already been cloned:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
```

From the repository root, start the example:

```console
$ funcdctl dev examples/secret-writer --gport 8080
```

In another terminal, write `TOKEN`, then delete it:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"put","value":"token-v2"}' http://127.0.0.1:8080/function/token-owner
{"token":"token-v2"}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"delete"}' http://127.0.0.1:8080/function/token-owner
{"token":null}
```

Press Ctrl-C in the first terminal to stop.

The Secret:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Secret
metadata:
  name: demo-token
  namespace: default
  resourceGroup: rg1
spec:
  owner:
    kind: Function
    name: token-owner
  data:
    TOKEN: dG9rZW4tdjE=   # base64("token-v1")
```

The Function:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: token-owner
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:token-owner   # funcdctl push token-owner.mjs
  scaling:
    minReplicas: 1
  secrets:
    - name: demo-token
      keys:
        - TOKEN
  bindings:
    secret:
      - demo-token
```

The handler:

```ts
import type { CloudEvent, FunctionContext } from '@funcd-dev/shim';

/** A put writes value into TOKEN; a delete removes TOKEN. */
export interface FuncInput {
  op: 'put' | 'delete';
  value?: string;
}

/** TOKEN as read after the write, or null when demo-token no longer holds it. */
export interface FuncOutput {
  token: string | null;
}

export async function handle(ctx: FunctionContext, event: CloudEvent<FuncInput>): Promise<FuncOutput> {
  const input = event.data;
  if (input?.op === 'put') {
    await ctx.secret.put('demo-token', 'TOKEN', input.value ?? '');
  } else if (input?.op === 'delete') {
    await ctx.secret.del('demo-token', 'TOKEN');
    // TOKEN is gone now: deleting a key that the Secret does not hold succeeds too.
    await ctx.secret.del('demo-token', 'TOKEN');
  }
  return { token: (await ctx.secret.get('TOKEN')) ?? null };
}
```

### Python

Put Python 3.12 or later on the `PATH` as `python3`. From the parent folder of the funcd-typescript checkout, run:

```console
$ git clone https://github.com/pyvvo/funcd-python
$ cd funcd-python
$ funcdctl dev examples/secret-writer --gport 8080
```

In another terminal, write `TOKEN`, then delete it:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"put","value":"token-v2"}' http://127.0.0.1:8080/function/py-token-owner
{"token":"token-v2"}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"delete"}' http://127.0.0.1:8080/function/py-token-owner
{"token":null}
```

Press Ctrl-C in the first terminal to stop.

The Secret:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Secret
metadata:
  name: py-demo-token
  namespace: default
  resourceGroup: rg1
spec:
  owner:
    kind: Function
    name: py-token-owner
  data:
    TOKEN: dG9rZW4tdjE=   # base64("token-v1")
```

The Function:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: py-token-owner
  namespace: default
  resourceGroup: rg1
spec:
  runtime: python314
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:py-token-owner   # funcdctl push of src/py-token-owner/main.py
  scaling:
    minReplicas: 1
  secrets:
    - name: py-demo-token
      keys:
        - TOKEN
  bindings:
    secret:
      - py-demo-token
```

The handler:

```py
from typing import Literal, NotRequired, TypedDict

from funcd_shim import CloudEvent, FunctionContext


class FuncInput(TypedDict):
    """A put writes value into TOKEN; a delete removes TOKEN."""

    op: Literal["put", "delete"]
    value: NotRequired[str]


class FuncOutput(TypedDict):
    """TOKEN as read after the write, or None when py-demo-token no longer holds it."""

    token: str | None


def handle(context: FunctionContext, event: CloudEvent[FuncInput]) -> FuncOutput:
    data = event["data"]
    if data["op"] == "put":
        context.secret.put("py-demo-token", "TOKEN", data.get("value", ""))
    elif data["op"] == "delete":
        context.secret.delete("py-demo-token", "TOKEN")
        # TOKEN is gone now: deleting a key that the Secret does not hold succeeds too.
        context.secret.delete("py-demo-token", "TOKEN")
    return {"token": context.secret.get("TOKEN")}


```

## Let another Function write a Secret

Restart the example from its repository root to restore the initial Secret. The first write is denied. Applying the writer role allows the next write without a restart.

### TypeScript

```console
$ funcdctl dev examples/secret-writer --gport 8080 --cport 8081
```

In another terminal, from the same repository folder:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/token-user
{"token":"token-v1","error":"context.secret.put failed: 403 {\"type\":\"urn:funcd:problem:forbidden\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\"secrets.CheckWrite: write secret \\\"demo-token\\\" in \\\"default\\\" denied: cedar: forbidden by policy builtin/secret-single-writer\"}\n"}
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f examples/secret-writer/fixtures/grant.yaml
applied RolesAssignment/token-user-writes
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/token-user
{"token":"token-v2"}
```

Press Ctrl-C in the first terminal to stop.

The RolesAssignment:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: token-user-writes
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Function
    name: token-user
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: Secret Data Writer
      scope:
        kind: Secret
        name: demo-token
```

The handler:

```ts
import type { CloudEvent, FunctionContext } from '@funcd-dev/shim';

export interface FuncInput {
  value: string;
}

/** TOKEN as this call last read it, and the error of a refused write. */
export interface FuncOutput {
  token: string | null;
  error?: string;
}

export async function handle(ctx: FunctionContext, event: CloudEvent<FuncInput>): Promise<FuncOutput> {
  const token = (await ctx.secret.get('TOKEN')) ?? null;
  try {
    await ctx.secret.put('demo-token', 'TOKEN', event.data?.value ?? '');
  } catch (err) {
    return { token, error: (err as Error).message };
  }
  return { token: (await ctx.secret.get('TOKEN')) ?? null };
}
```

### Python

```console
$ funcdctl dev examples/secret-writer --gport 8080 --cport 8081
```

In another terminal, from the same repository folder:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/py-token-user
{"token":"token-v1","error":"context.secret.put failed: 403 {\"type\":\"urn:funcd:problem:forbidden\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\"secrets.CheckWrite: write secret \\\"py-demo-token\\\" in \\\"default\\\" denied: cedar: forbidden by policy builtin/secret-single-writer\"}\n"}
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f examples/secret-writer/fixtures/grant.yaml
applied RolesAssignment/py-token-user-writes
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/py-token-user
{"token":"token-v2"}
```

Press Ctrl-C in the first terminal to stop.

The RolesAssignment:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: py-token-user-writes
  namespace: default
  resourceGroup: rg1
spec:
  principal:
    kind: Function
    name: py-token-user
  assignments:
    - roleRef:
        kind: BuiltinRole
        name: Secret Data Writer
      scope:
        kind: Secret
        name: py-demo-token
```

The handler:

```py
from typing import NotRequired, TypedDict

from funcd_shim import CloudEvent, FunctionContext


class FuncInput(TypedDict):
    value: str


class FuncOutput(TypedDict):
    """TOKEN as this call last read it, and the error of a refused write."""

    token: str | None
    error: NotRequired[str]


def handle(context: FunctionContext, event: CloudEvent[FuncInput]) -> FuncOutput:
    token = context.secret.get("TOKEN")
    try:
        context.secret.put("py-demo-token", "TOKEN", event["data"]["value"])
    except RuntimeError as err:
        return {"token": token, "error": str(err)}
    return {"token": context.secret.get("TOKEN")}


```

## Access

- A Function can read the Secrets it binds (`secret::read`). The declared keys check readiness; they do not restrict which keys the binding exposes.
- A Function or a Job can write a bound Secret whose `spec.owner` names it by kind and name (`secret::write`). Other writers need `Secret Data Writer`, scoped to the Secret or its namespace.
- `Secret Data Reader` adds no access beyond a binding. These data roles apply to Functions. The general roles `Reader`, `Contributor` and `Owner` include no Secret actions.

See the complete RolesAssignment in [Let another Function write](#let-another-function-write-a-secret).

funcd supplies this Cedar policy in every namespace:

```cedar title="Built-in Secrets policy"
@id("secret-read-binding")
permit(principal, action == Action::"secret::read", resource)
  when { principal has secretBindings && principal.secretBindings.contains(resource) };

@id("secret-write-base")
permit(principal, action == Action::"secret::write", resource);

@id("secret-single-writer")
forbid(principal, action == Action::"secret::write", resource)
  unless { resource has writers && resource.writers.contains(principal) };
```

A namespace Policy can forbid a read or write even when ownership, a binding or a role allows it. A forbidden read affects the Function's readiness. A forbidden write does not. See [Security](https://funcd.dev/docs/develop/security-and-networking/security.md#write-a-policy).

This Policy forbids `env-echo` to read `app-secret`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Policy
metadata:
  name: forbid-app-secret
  namespace: default
  resourceGroup: rg1
spec:
  cedar: |
    forbid(
      principal == Function::"default/env-echo",
      action == Action::"secret::read",
      resource == Secret::"default/app-secret"
    );
```

A Function binds Secrets in its own namespace. For a Workflow step, ownership names the invoked Function: `<workflow>-<step>` for an inline step, or the existing Function for a referenced step.

An [App](https://funcd.dev/docs/develop/workloads/app/spec.md#appspecsecrets) or [Workflow](https://funcd.dev/docs/develop/workloads/workflow/spec.md#workflowspecsecrets) declares Secrets on the parent resource. Its Functions bind them.

People access Secrets through the control-plane API using their credential's role. An admin or a developer of the namespace can read and write them. A viewer cannot read them. Cedar does not decide these API requests.

## Limits and quotas

A write's JSON body, including the value, can hold at most 1 MiB. A larger write changes nothing. Deletes send no body.

## Data storage

Secrets live in funcd's metastore. They survive a restart with `storage.mode: file`, the default, and are lost with `storage.mode: memory`.

Secrets are stored unencrypted by default. Set `secrets.encryptionKeyFile` to a file containing exactly 32 bytes to encrypt them with AES-256. funcd refuses to start if the stored Secrets do not match the configured encryption mode or key. See [server configuration](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml).

## Status

A Secret has no status. Check the Function that uses it:

```console
$ funcdctl get function env-echo -n default -o json
```

For a local platform, add the `--server` and `--token` flags printed by `funcdctl dev`.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| `Pending` | `SecretNotFound` | While no worker serves: a declared Secret does not exist. The message names it. |
| `Pending` | `SecretKeyMissing` | While no worker serves: a declared Secret lacks a declared key, which the message names. |
| `Failed` | `SecretResolveFailed` | While no worker serves: a bound Secret holds a value that is not UTF-8 text, or that contains a NUL byte. |
| `Degraded` | `DependencyNotReady` | A Policy forbids a read, and the Function has served. The message names the binding, such as `secret binding "app-secret": …`. |
| `Deploying` | `DependencyNotReady` | A Policy forbids a read, and the Function has not served yet. |
| `RevisionReady` condition | `SecretNotFound`, `SecretKeyMissing` or `SecretResolveFailed` | While a worker serves, the phase stays `Ready`, and the reason is on this condition once funcd has checked the Secrets again. |
| Any other reason | | See the [Function's Status](https://funcd.dev/docs/develop/workloads/function.md#status). |

funcd checks a Pending Function again every `controller.referentPollInterval`, 2 seconds by default. A Function with dedicated workers may show the updated Secret condition only after another change, such as a Function update or a worker stopping.

For binary data, base64-encode the data, then encode that text again for `spec.data`. Decode it once in the handler. Values written through `ctx.secret.put` or provided by the shell need only the first encoding.

## Changes and deletion

- Each read returns the current values. When bound Secrets share a key, the last Secret in `spec.bindings.secret` wins. Keys starting with `FUNCD_` are not returned.
- Applying a Secret manifest replaces its data, including keys written by a Function.
- Removing a declared key prevents new workers from starting until the key is restored. Existing workers keep serving and the Function stays Ready.
- Deleting a bound Secret prevents reads from all of the Function's bound Secrets: `get` returns no value and `list` fails. New workers wait until the Secret and its declared keys exist again. Existing workers keep serving and the Function stays `Ready`.
- A namespace Policy that forbids reading a bound Secret makes the Function's workers unready within `runtime.supervisionPeriod`, 10 seconds by default. Removing the Policy restores readiness without changing the Function.
- Changing a Lake's bound Secret replaces its engine. See [Lake](https://funcd.dev/docs/develop/services/lake.md#changes-and-deletion).
- A Function that owns Secrets shares workers only with Functions that own the same Secrets. Changing ownership can move it to other workers.
- Deleting a Function, Workflow or App does not delete its Secrets.

## CLI errors

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no python interpreter found for the python handler` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `cannot load the runtime shim (needs Python ≥3.12; set FUNCD_PYTHON)` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `… declares Secret <secret> with key <key>; set it in the shell … or under dev.env in funcdctl.config.yaml` | No file of the folder defines a Secret that a Function declares, and no source holds the key. Set the key as [Run it locally](#run-it-locally) explains, or add the Secret's file. |

## Run it locally

`funcdctl dev` keeps Secrets in memory. With `--persist`, it stores them unencrypted under `.funcd-dev/metastore`, or under the folder set by `--persist-to`. Keep that folder out of version control. Delete the persist folder after stopping the platform to clear all local state.

Each startup or file reload reapplies the folder's Secret manifests and replaces values written by Functions. Ownership and writer roles are enforced locally too.

For a declared Secret without a manifest, funcdctl reads each declared key from the shell, then `dev.envFile`, then `dev.env` in `funcdctl.config.yaml`. A missing key stops startup. See [funcdctl dev](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-dev).

From the funcd-typescript repository root, run the example with values from the shell:

```console
$ rm examples/env-echo/secret.yaml
$ API_KEY=from-shell SHARED=also-from-shell funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call the Function:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"from-shell","shared":"also-from-shell"}
```

Press Ctrl-C to stop, then run `git checkout examples/env-echo/secret.yaml` to restore the file.

## Examples

- [env-echo](https://github.com/pyvvo/funcd-typescript/tree/main/examples/env-echo): read Secret values and a ConfigMap setting.
- secret-writer: [TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/secret-writer) and [Python](https://github.com/pyvvo/funcd-python/tree/main/examples/secret-writer). Write and delete a key, then grant another Function access.
