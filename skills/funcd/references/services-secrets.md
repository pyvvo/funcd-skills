# Secrets

Source: https://pyvvo.github.io/funcd/docs/develop/services/secrets.md (the Markdown copy of the page; prefer it when the network is up).

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

A Secret holds named values, such as an API key, that a Function reads but that stay out of its code and its
configuration. A Function declares and binds each Secret that it reads, and its handler reads the values through
`ctx.secret`, the Secret client of the context that every handler receives. A Function can also change a bound
Secret's keys if it owns the Secret or has a role that allows writes. funcd puts no value of a Secret in the
environment of a [worker](https://pyvvo.github.io/funcd/docs/platform/workloads.md#runtime), where the Function's code runs. See
[how Secrets work](https://pyvvo.github.io/funcd/docs/platform/services/secrets.md) for the concept.

The env-echo example, in TypeScript, reads two keys of a Secret and returns their values. The steps change one value
while the example runs, and the next call returns the new value from the same worker.

Install the [dev build of funcdctl](https://pyvvo.github.io/funcd/docs/get-started/install.md), Git and curl, and put Node.js on the `PATH`.

`funcdctl dev` starts a local platform, applies the resource files of one folder, and prints the URL of each Function,
on the port that `--gport` sets. It runs each Function from the code in the folder, not from the manifest's `image`,
the bundle that `funcdctl push` writes for a platform to run.

### TypeScript

Clone the repository and start the example from its root folder:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call the Function. The Function takes no input, so the call sends no body:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"s3cr3t","shared":"from-secret"}
```

`config` comes from a ConfigMap, through the worker's environment; `secret` and `shared` come from the Secret, through
`ctx.secret`. The example returns the Secret's values only to show them: a handler that serves real callers does not
return a Secret's value.

To check that the handler reads the Secret on each call, change the value of `API_KEY` while `funcdctl dev` runs.
Encode the new value, `rotated`, in base64:

```console
$ printf '%s' rotated | base64
cm90YXRlZA==
```

In `examples/env-echo/secret.yaml`, replace the value of `API_KEY`, `czNjcjN0`, with `cm90YXRlZA==`, and save the
file. `funcdctl dev` applies the saved file within about a second. Call the Function again:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"rotated","shared":"from-secret"}
```

The response contains the new value, and no worker restarted: the terminal that runs `funcdctl dev` prints a
`funcd-shim: listening on` line each time a worker starts, and it printed no new one.

Press Ctrl-C in the first terminal to stop the example.

The example's folder holds the Secret `app-secret`, the ConfigMap `app-config` and the Function `env-echo`, beside two
Routes that the steps do not use and a server configuration, `funcdconfig.yaml`, which `funcdctl dev` skips. The
Secret holds two keys, `API_KEY` and `SHARED`, under `spec.data`. Each value is written in base64, and each key is an
environment variable name: a letter or an underscore, then letters, digits and underscores.

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

The ConfigMap holds two settings that are not secret, `APP_MODE` and `SHARED`. funcd gives the keys of a bound
ConfigMap to each worker as environment variables, with the exceptions that
[Choose a ConfigMap's keys](https://pyvvo.github.io/funcd/docs/develop/workloads/configuration.md#choose-a-configmaps-keys) lists. One of them applies
here: a key that a bound Secret also holds, such as `SHARED`, is left out.

The Function **declares** the Secret under [`spec.secrets`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecsecrets),
with the keys that its code reads, and waits in `Pending` until the Secret exists and holds every declared key. It
**binds** the Secret under `spec.bindings.secret`; a binding can name only a Secret that `spec.secrets` declares, and
the binding is what allows the Function to read the Secret, as [Access](#access) explains. An App declares the Secrets
of its parts under its own [`spec.secrets`](https://pyvvo.github.io/funcd/docs/develop/workloads/app/spec.md#appspecsecrets), and a Workflow those of its
steps under its [`spec.secrets`](https://pyvvo.github.io/funcd/docs/develop/workloads/workflow/spec.md#workflowspecsecrets); each part or step binds them
as a Function does.

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

The handler returns `APP_MODE` from its environment, and `API_KEY` and `SHARED` from `ctx.secret.get`:

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

`ctx.secret` reads with two methods, listed with the others in the [Handler API](https://pyvvo.github.io/funcd/docs/develop/services/secrets/spec.md#handler-api):

- `get` returns the value of one key, or `undefined` (`None` in Python) when no bound Secret holds the key or when the
  key starts with `FUNCD_`.
- `list` returns every key that the bound Secrets hold, except a key that starts with `FUNCD_`, in sorted order.

The declared keys are a check, not a filter: the handler can read every key of a bound Secret, except a key that
starts with `FUNCD_`. Each call of `get` or `list` asks funcd, with no cache, so each call returns the current values.
When two bound Secrets hold the same key, the handler reads the value of the Secret that comes later in
`spec.bindings.secret`.

## Write a key of a Secret

A Function writes the keys of a Secret whose `spec.owner` names it, while it binds the Secret. The owner is one
Function of the Secret's namespace; [Access](#access) explains which other Functions can write. The secret-writer
example's owner writes a key, reads it back, and deletes it. Its Secret holds one key, `TOKEN`, whose first value is a
dummy, `token-v1`. The example needs funcdctl, Git and curl, as the first example does, and the runtime of its
language on the `PATH`: Node.js for TypeScript, or Python 3.12 or later as `python3` for Python.

The owner's handler writes with two methods of `ctx.secret`, whose first argument names a Secret of the Function's
`spec.bindings.secret`:

- `put(binding, key, value)` sets the key to the value, a string.
- `del(binding, key)` in TypeScript, and `delete(binding, key)` in Python, removes the key. Removing a key that the
  Secret does not hold is no error: the example's handler removes `TOKEN` twice.

Neither method returns a value. In TypeScript, each returns a promise, which the handler awaits, so that the write is
done before the handler reads the key again. The next read of each Function that binds the Secret returns the change,
with no restart, unless a Secret that comes later in that Function's `spec.bindings.secret` holds the same key.

A write changes keys only: it never creates or deletes the Secret itself. funcd checks a written key as it checks the
keys of an applied Secret, and a written value as a read does: the key must be an environment variable name, and the
value must be UTF-8 text without a NUL byte. A write fails, and changes nothing, when the Secret does not exist or when
a key or a value fails these checks. A key that starts with `FUNCD_` is stored, but no read returns it. When other
writes change the Secret during each of 5 attempts, nothing is written: make the call again.

When funcd refuses a write, the method throws an error in TypeScript, and raises a `RuntimeError` in Python, whose
message names the method, the HTTP status and funcd's explanation, such as `context.secret.put failed: 403 …`. A
handler that does not catch the error makes the call to the Function fail with the HTTP status 500.

The example's Functions declare `TOKEN` under `spec.secrets`, so funcd starts no new worker for them while the Secret
lacks `TOKEN`, as [Changes and deletion](#changes-and-deletion) explains. A worker that already serves goes on
serving: the example sets no `scaling.idleTimeout`, and without one, funcd never reclaims an idle worker. The
Functions' `scaling.minReplicas: 1` starts the worker of each Function before its first call.

### TypeScript

The folder holds both handlers already built, as `token-owner.mjs` and `token-user.mjs`, so the example needs no build
step. Without the clone of the first example, clone the repository first:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
```

In the root folder of the funcd-typescript repository, start the example:

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

The first response holds the value that the owner reads after its write, and the second `null`, since the Secret no
longer holds `TOKEN`. Press Ctrl-C in the first terminal to stop the example.

The Secret `demo-token`, in
[examples/secret-writer/secret.yaml](https://github.com/pyvvo/funcd-typescript/blob/main/examples/secret-writer/secret.yaml),
names the Function `token-owner` as its owner. `dG9rZW4tdjE=` is `token-v1` in base64.

```yaml
apiVersion: funcd.io/v1alpha1
kind: Secret
metadata:
  name: demo-token
  namespace: default
  resourceGroup: rg1
spec:
  owner: token-owner
  data:
    TOKEN: dG9rZW4tdjE=   # base64("token-v1")
```

The Function `token-owner`, in
[examples/secret-writer/token-owner.yaml](https://github.com/pyvvo/funcd-typescript/blob/main/examples/secret-writer/token-owner.yaml),
declares and binds `demo-token`, as `env-echo` declares and binds `app-secret`:

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

The handler takes the call's input from `event.data`, whose type is `FuncInput`: the operation `op`, which is `put` or
`delete`, and the `value` that a put writes into `TOKEN`. After the write, it reads `TOKEN` with `ctx.secret.get`.
The types `CloudEvent` and `FunctionContext`, of the call's event and of the context, come from `@funcd-dev/shim`, the
package of funcd's TypeScript types. This excerpt of
[examples/secret-writer/src/token-owner/main.ts](https://github.com/pyvvo/funcd-typescript/blob/main/examples/secret-writer/src/token-owner/main.ts)
leaves out only the file's first comment:

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

The folder's `pyproject.toml` lists the entry of each Function under `[tool.funcd-bundle.functions]`, and
`funcdctl dev` runs each entry with the `python3` of the `PATH`. Neither handler imports a third-party package, so the
example needs no installation step. Clone the repository and start the example from its root folder:

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

The first response holds the value that the owner reads after its write, and the second `null`, since the Secret no
longer holds `TOKEN`. Press Ctrl-C in the first terminal to stop the example.

The Secret `py-demo-token`, in
[examples/secret-writer/secret.yaml](https://github.com/pyvvo/funcd-python/blob/main/examples/secret-writer/secret.yaml),
names the Function `py-token-owner` as its owner. `dG9rZW4tdjE=` is `token-v1` in base64.

```yaml
apiVersion: funcd.io/v1alpha1
kind: Secret
metadata:
  name: py-demo-token
  namespace: default
  resourceGroup: rg1
spec:
  owner: py-token-owner
  data:
    TOKEN: dG9rZW4tdjE=   # base64("token-v1")
```

The Function `py-token-owner`, in
[examples/secret-writer/py-token-owner.yaml](https://github.com/pyvvo/funcd-python/blob/main/examples/secret-writer/py-token-owner.yaml),
declares and binds `py-demo-token`, as `env-echo` declares and binds `app-secret`:

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

The handler takes the call's input from `event["data"]`, whose type is `FuncInput`: the operation `op`, which is `put`
or `delete`, and the `value` that a put writes into `TOKEN`. After the write, it reads `TOKEN` with
`context.secret.get`, which returns `None` when the Secret no longer holds the key; the response shows `None` as
`null`. The types `CloudEvent` and `FunctionContext`, of the call's event and of the context, come from `funcd_shim`,
the package of funcd's Python types. This excerpt of
[examples/secret-writer/src/py-token-owner/main.py](https://github.com/pyvvo/funcd-python/blob/main/examples/secret-writer/src/py-token-owner/main.py)
leaves out only the file's first docstring:

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

A Secret has at most one owner. To let another Function write it too, grant that Function the built-in role
`Secret Data Writer` with a RolesAssignment. Its scope names one Secret, with the kind `Secret` and the Secret's name,
or the whole namespace, with the kind `Namespace`. Like the owner, the Function writes only a Secret that it binds,
with the same methods. funcd reads the RolesAssignments of the namespace at each write, so the grant takes effect at
the next write. A Policy that forbids the write still wins over the grant, as [Access](#access) explains.

The second Function of the secret-writer example, `token-user` in TypeScript and `py-token-user` in Python, declares
and binds the Secret of the previous section in the same way as the owner, but it does not own the Secret. Each call
reads `TOKEN`, then tries to write the call's `value` into it. When funcd refuses the write, the handler returns the
value that it read and the message of the error in `error`; otherwise, it returns `TOKEN` as it reads it after the
write. The RolesAssignment that grants this Function the role is in the example's `fixtures` folder, which
`funcdctl dev` does not apply: it applies only the files at the top of the folder.

The steps start the example again, call the second Function, apply the RolesAssignment, and call the Function again.
To apply it, `funcdctl` reaches the control plane of the local platform with `--server` and the token
`funcd-dev-token`; the `--cport` flag sets the control plane's port, so the commands use the port 8081. The first call
returns `"token":"token-v1"`, since each start of `funcdctl dev` applies the folder's `secret.yaml` again, and an error
that holds the HTTP status 403 and names the rule `builtin/secret-single-writer` of the built-in policy that
[Access](#access) quotes. The second call writes `token-v2` and returns it.

### TypeScript

In the root folder of the funcd-typescript repository, start the example again:

```console
$ funcdctl dev examples/secret-writer --gport 8080 --cport 8081
```

In another terminal, in the same folder, call `token-user`, apply the RolesAssignment, and call `token-user` again:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/token-user
{"token":"token-v1","error":"context.secret.put failed: 403 {\"type\":\"urn:funcd:problem:forbidden\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\"secrets.CheckWrite: write secret \\\"demo-token\\\" in \\\"default\\\" denied: cedar: forbidden by policy builtin/secret-single-writer\"}\n"}
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f examples/secret-writer/fixtures/grant.yaml
applied RolesAssignment/token-user-writes
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/token-user
{"token":"token-v2"}
```

Press Ctrl-C in the first terminal to stop the example.

The RolesAssignment `token-user-writes`, in
[examples/secret-writer/fixtures/grant.yaml](https://github.com/pyvvo/funcd-typescript/blob/main/examples/secret-writer/fixtures/grant.yaml),
grants `token-user` the role `Secret Data Writer` on `demo-token`:

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

The handler of `token-user` takes the `value` to write from `event.data`. This excerpt of
[examples/secret-writer/src/token-user/main.ts](https://github.com/pyvvo/funcd-typescript/blob/main/examples/secret-writer/src/token-user/main.ts)
leaves out only the file's first comment:

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

In the root folder of the funcd-python repository, start the example again:

```console
$ funcdctl dev examples/secret-writer --gport 8080 --cport 8081
```

In another terminal, in the same folder, call `py-token-user`, apply the RolesAssignment, and call `py-token-user`
again:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/py-token-user
{"token":"token-v1","error":"context.secret.put failed: 403 {\"type\":\"urn:funcd:problem:forbidden\",\"title\":\"Forbidden\",\"status\":403,\"detail\":\"secrets.CheckWrite: write secret \\\"py-demo-token\\\" in \\\"default\\\" denied: cedar: forbidden by policy builtin/secret-single-writer\"}\n"}
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token apply -f examples/secret-writer/fixtures/grant.yaml
applied RolesAssignment/py-token-user-writes
$ curl -s -X POST -H 'content-type: application/json' -d '{"value":"token-v2"}' http://127.0.0.1:8080/function/py-token-user
{"token":"token-v2"}
```

Press Ctrl-C in the first terminal to stop the example.

The RolesAssignment `py-token-user-writes`, in
[examples/secret-writer/fixtures/grant.yaml](https://github.com/pyvvo/funcd-python/blob/main/examples/secret-writer/fixtures/grant.yaml),
grants `py-token-user` the role `Secret Data Writer` on `py-demo-token`:

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

The handler of `py-token-user` takes the `value` to write from `event["data"]`, and catches the `RuntimeError` of a
refused write. This excerpt of
[examples/secret-writer/src/py-token-user/main.py](https://github.com/pyvvo/funcd-python/blob/main/examples/secret-writer/src/py-token-user/main.py)
leaves out only the file's first docstring:

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

A Function needs no role assignment to:

- **Read the Secrets that it binds** (`secret::read`). Each entry of `spec.bindings.secret` lets the Function read
  that Secret through `ctx.secret`. At each read, funcd asks Cedar whether the Function may read each Secret that it
  binds.
- **Write the Secret that it owns** (`secret::write`). The Function that `spec.owner` names can write the Secret's
  keys while it binds the Secret. At each write, funcd asks Cedar whether the Function may write that Secret. A
  Workflow's function step writes as the Function that it calls: a function step that names an `image` runs as the
  Function `<workflow>-<step>`, which funcd creates for the step, and a function step that names an existing Function
  by `ref` runs as that Function. To let a function step write a Secret, the Secret's `spec.owner` names that
  Function.

Any other write needs a role. funcd has two built-in roles for Secrets:

- `Secret Data Writer` allows the actions `secret::read` and `secret::write`. It is the smallest role that lets a
  Function write a Secret that it binds and does not own, as
  [Let another Function write a Secret](#let-another-function-write-a-secret) shows.
- `Secret Data Reader` allows the action `secret::read` only. It lets a Function read nothing more than its bindings
  do: `ctx.secret` reads only the Secrets that the Function binds, and each binding already allows the read.

Both roles act only for a Function, because funcd reads and writes a Secret for no Identity. The built-in roles
`Reader`, `Contributor` and `Owner` include no Secret action. The Security page explains how to
[choose a role](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#choose-a-role), and the
[Security](https://pyvvo.github.io/funcd/docs/platform/security-and-networking/security.md) page of the Platform chapter explains where funcd
asks Cedar.

funcd applies these rules as a built-in policy in every namespace, so nothing needs to be written or installed. In
Cedar, the built-in policy reads:

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

A write by a Function that neither owns the Secret nor holds a writer role fails with the HTTP status 403 and
`cedar: forbidden by policy builtin/secret-single-writer`, as the previous section shows: give the Function a writer
role. A write also fails when its first argument names a Secret that the Function does not bind: bind the Secret.

A [Policy](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#write-a-policy) of the namespace can deny a read or a
write that these rules allow, because a `forbid` statement overrides every `permit`. This Policy forbids the Function
`env-echo` to read the Secret `app-secret`:

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

While the Policy exists:

- Each `ctx.secret` read of `env-echo` fails with the HTTP status 403, and its error names the rule:
  `cedar: forbidden by policy default/forbid-app-secret#0`. A read fails even for a key that another bound Secret
  holds, because funcd reads every bound Secret for each read. Another Function that binds `app-secret` still reads it.
- Within `runtime.supervisionPeriod`, 10 seconds by default, the workers of `env-echo` stop being ready, and they do
  not restart. The Function is then `Degraded`, and each call waits for a ready worker until
  `invoke.activationTimeout`, 30 seconds by default, then fails.

Once the Policy is deleted, the next read succeeds, and the workers are ready again within
`runtime.supervisionPeriod`, with no change to the Function.

A `forbid` of the action `secret::write` denies writes in the same way, those of the owner included: each write fails
with the HTTP status 403 and names the Policy. It does not change the Function's readiness, which checks only reads.

A Function binds only Secrets of its own namespace, and a RolesAssignment or a Policy decides only the reads and the
writes of its own namespace's Functions and Secrets.

People read and write Secrets through funcd's API, where the role of the caller's credential decides, not Cedar: an
admin, or a developer of the Secret's namespace, can read and write Secrets, and a viewer can never read one. A Policy
does not change these reads and writes. [funcd's configuration](https://pyvvo.github.io/funcd/docs/develop/running-funcd/spec.md#funcdconfigyaml)
describes the roles under `auth.credentials`.

## Limits and quotas

A put sends its value to funcd in a JSON body, `{"value": "<text>"}`, which holds at most 1 MiB, the JSON around the
value included. A larger put fails, and nothing is written. A delete sends no body, so this limit applies to a put
only.

## Data storage

funcd stores each Secret in its metastore, the store that holds every object of the API. With `storage.mode: file`,
the default, the metastore is on disk, in the `store` folder of `storage.dataDir` unless `storage.metastoreDir` names
another folder, and the Secrets survive a restart. With `storage.mode: memory`, the Secrets are lost when funcd stops.
A key that a Function writes is stored in the same Secret, in the same way.

By default, the metastore holds the Secrets unencrypted, and with `storage.mode: file`, funcd logs a warning at start.
To encrypt them, set `secrets.encryptionKeyFile` to a file that holds a key of exactly 32 bytes: funcd then encrypts
each Secret that it stores with AES-256. funcd refuses to start when the stored Secrets were written in another way:
with another key, with a key while none is set, or without a key while one is set.
[funcd's configuration](https://pyvvo.github.io/funcd/docs/develop/running-funcd/spec.md#funcdconfigyaml) describes each of these settings.

## Status

A Secret has no status. The Function that declares it reports a Secret that is missing, or that it cannot read.
`funcdctl get function env-echo -n default -o json` prints the Function's phase and conditions under `status`. With
`funcdctl dev`, add the `--server` and `--token` flags that its banner prints.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| `Pending` | `SecretNotFound` | While no worker serves: a declared Secret does not exist. The message names it. |
| `Pending` | `SecretKeyMissing` | While no worker serves: a declared Secret lacks a declared key, which the message names. |
| `Failed` | `SecretResolveFailed` | While no worker serves: a bound Secret holds a value that is not UTF-8 text, or that contains a NUL byte. |
| `Degraded` | `DependencyNotReady` | A Policy forbids a read, and the Function has served. The message names the binding, such as `secret binding "app-secret": …`. |
| `Deploying` | `DependencyNotReady` | A Policy forbids a read, and the Function has not served yet. |
| `RevisionReady` condition | `SecretNotFound`, `SecretKeyMissing` or `SecretResolveFailed` | While a worker serves, the phase stays `Ready`, and the reason is on this condition once funcd has checked the Secrets again. |
| Any other reason | | See the [Function's Status](https://pyvvo.github.io/funcd/docs/develop/workloads/function.md#status). |

funcd checks a `Pending` Function again every `controller.referentPollInterval`, 2 seconds by default, and the
Function leaves `Pending` once each declared Secret exists with every declared key. A Function that runs in workers of
its own can show no reason for a while: funcd checks its Secrets again only after another change, such as an update
of the Function or a worker that stops.

Binary data takes two base64 encodings in a manifest, to avoid `SecretResolveFailed`: the first turns it into text,
and the second is the encoding that every value of `spec.data` has. The handler reads the text of the first encoding,
and decodes it once. A value that a Function writes, or that `funcdctl dev` takes from the shell or from an envFile, as
[Run it locally](#run-it-locally) explains, is stored as it is, so binary data in it is encoded once.

## Changes and deletion

- The Function's next read returns a changed value, with no restart, whether a person or a Function changed it, as the
  first example shows, unless a Secret that comes later in its `spec.bindings.secret` holds the same key. A Lake reads
  differently: its engine reads its Secrets only when it starts, so a changed value replaces the engine, as the Lake's
  [Spec](https://pyvvo.github.io/funcd/docs/develop/services/lake/spec.md#lakespecbindings) tab says.
- A person's apply of a Secret replaces its data, so a key that a Function wrote is gone after the apply unless the
  applied manifest holds it.
- When a bound Secret loses a key, `get` returns `undefined` (`None` in Python) for that key, and `list` leaves it
  out. The other keys read as before. When `spec.secrets` declares the lost key, funcd starts no new worker for the
  Function until the key is back.
- When a bound Secret is deleted, the Function's reads return no value at all, because funcd reads every bound Secret
  for each read: `get` returns `undefined` (`None`) for every key, even a key that another bound Secret still holds, and
  `list` throws an error (raises one in Python). env-echo then returns empty strings. funcd starts no new worker for
  the Function until the Secret exists again with every declared key.
- In both cases, a worker that serves goes on serving, and the Function stays `Ready`, as [Status](#status) explains.
- When a person names as a Secret's owner a Function that binds the Secret and shares its workers with other
  Functions, through [`spec.pooling`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecpooling), funcd moves the Function to
  other workers: an owner never shares a worker with a Function that does not own the same Secrets.
- Deleting a Function, a Workflow or an App never deletes a Secret that it declares or binds.

## CLI errors

`funcdctl dev` stops before it serves the examples when it meets one of these local setup errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no python interpreter found for the python handler` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `cannot load the runtime shim (needs Python ≥3.12; set FUNCD_PYTHON)` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `… declares Secret <secret> with key <key>; set it in the shell … or under dev.env in funcdctl.config.yaml` | No file of the folder defines a Secret that a Function declares, and no source holds the key. Set the key as [Run it locally](#run-it-locally) explains, or add the Secret's file. |

## Run it locally

`funcdctl dev` keeps its Secrets in memory, so they are gone when it stops. With `--persist`, it keeps them between
runs in the `metastore` folder of `.funcd-dev` in the current folder, or of the folder that `--persist-to` names. The
Secrets' values are stored there unencrypted, because `funcdctl dev` sets no encryption key. Deleting that folder after
`funcdctl dev` stops clears all the state that the local platform stored, Secrets included: its resources and its KV,
blob, SQL, lake and volume data. Keep the persist folder out of version control, for example with a `.funcd-dev/` line
in `.gitignore`: the example's repository does not ignore it, so `git status` lists it.

At each start, with `--persist` too, and each time it applies the folder again after a saved file, `funcdctl dev`
applies each Secret of the folder again, which replaces the keys that a Function wrote. Writes work under
`funcdctl dev` as on a platform: the owner and the writers that a RolesAssignment names write, and `funcdctl dev`
grants no Secret role of its own, as
[Let another Function write a Secret](#let-another-function-write-a-secret) shows.

`funcdctl dev` also creates each Secret that a Function of the folder declares and that no file of the folder
defines. It takes the value of each declared key from the shell's environment, else from the file that `dev.envFile`
names in `funcdctl.config.yaml`, in the current folder, else from `dev.env` in that file. A key that none of them
holds stops `funcdctl dev` before the platform starts, as [CLI errors](#cli-errors) shows. A value can thus stay out of
the folder and out of its repository. For example, the first example also runs without its `secret.yaml`, with values
from the shell. In the repository's root folder, run:

```console
$ rm examples/env-echo/secret.yaml
$ API_KEY=from-shell SHARED=also-from-shell funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call the Function:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"from-shell","shared":"also-from-shell"}
```

The worker does not get these values in its environment either: it inherits only a few variables of the shell, such
as `PATH` and `HOME`. After the example stops, `git checkout examples/env-echo/secret.yaml` brings the file back.

## Examples

- [env-echo in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/env-echo): a Function that
  reads two keys of a Secret through `ctx.secret`, and a setting of a ConfigMap from its environment.
- [secret-writer in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/secret-writer) and
  [in Python](https://github.com/pyvvo/funcd-python/tree/main/examples/secret-writer): the owner of a Secret, which
  writes and deletes one of its keys through `ctx.secret`, and another Function, which writes the key once a
  RolesAssignment gives it the role `Secret Data Writer`.
