# Configuration

Source: https://pyvvo.github.io/funcd/docs/develop/workloads/configuration.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Choose a ConfigMap's keys
- Read a setting through ctx.config
- Define the settings in the Function
- Share settings between Functions
- Override a shared setting
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Give a Function settings that are not secret through a ConfigMap, and read them in the handler.

## Usage

A ConfigMap holds settings that are not secret, such as a mode or a log level, as keys with string values. Each
[worker](https://pyvvo.github.io/funcd/docs/platform/workloads.md#runtime) of a Function that binds a ConfigMap, a process that runs the
Function's code, gets the ConfigMap's keys as environment variables when it starts. See
[how workloads use their configuration](https://pyvvo.github.io/funcd/docs/platform/workloads/configuration.md) for the concept.

The env-echo example returns one setting from a ConfigMap and two values from a Secret, a resource that holds values
that must stay private. A call returns `"config":"prod"`, the value that the ConfigMap sets for the key `APP_MODE`.

Install the [dev build of funcdctl](https://pyvvo.github.io/funcd/docs/get-started/install.md), Git and curl, and put Node.js on the `PATH`.

The Function declares the ConfigMap by `ref` under [`spec.configMaps`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecconfigmaps),
since the ConfigMap is a separate resource, and binds it under
[`spec.bindings.config`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecbindings). A binding can name only a ConfigMap that its
Function declares, or, for a Function of an App, one that the App declares. The [Spec](https://pyvvo.github.io/funcd/docs/develop/workloads/configuration/spec.md) tab describes a
ConfigMap's `data`.

`funcdctl dev` starts a local platform, runs the resource files of one folder on it, and prints the URL of each
Function, on the port that `--gport` sets. It runs the Function from its build in the folder, `env-echo.mjs`, which
the repository already holds, not from the manifest's `image`, the bundle that `funcdctl push` writes for a platform
to run. The folder's two Route files and its funcd server configuration are not used here, and `funcdctl dev` ignores
the server configuration.

### TypeScript

The ConfigMap `app-config` sets `APP_MODE` to `prod` and `SHARED` to `from-config`:

```yaml
# app-config: settings that are not secret, which env-echo binds under spec.bindings.config. Each worker gets its
# keys as environment variables when it starts; unlike a Secret's values, these are plain text. SHARED is also a key
# of the Secret app-secret, so funcd leaves it out of the environment, and the handler reads the Secret's value.
apiVersion: funcd.io/v1alpha1
kind: ConfigMap
metadata:
  name: app-config
  namespace: default
  resourceGroup: rg1
spec:
  data:
    APP_MODE: prod
    SHARED: from-config
```

The Function `env-echo` declares and binds the ConfigMap `app-config`. It also declares the Secret
[`app-secret`](https://github.com/pyvvo/funcd-typescript/blob/main/examples/env-echo/secret.yaml), which holds
`API_KEY` and `SHARED`, under `spec.secrets` with the keys that its code reads, and binds it under
`spec.bindings.secret`:

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

Clone the repository and start the example from its root folder:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call the Function. It takes no input, so the request has no body:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"s3cr3t","shared":"from-secret"}
```

The handler reads `APP_MODE` from its environment as `process.env.APP_MODE`, and reads `API_KEY` and `SHARED` through
[`ctx.secret`](https://pyvvo.github.io/funcd/docs/develop/services/secrets.md):

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

`config` is the ConfigMap's `APP_MODE`, and `secret` is the Secret's `API_KEY`. `shared` is the Secret's `SHARED`,
`from-secret`: the ConfigMap's `SHARED` does not reach the environment, because the bound Secret also holds that key.

Press Ctrl-C in the first terminal to stop the example.

## Choose a ConfigMap's keys

Each key of a ConfigMap is the name of an environment variable: ASCII letters, digits and `_`, not starting with a
digit. `funcdctl apply` refuses a ConfigMap with any other key. A worker gets every key of the ConfigMaps that its
Function binds, with three exceptions:

- A key that starts with `FUNCD_` is left out, because funcd reserves that prefix for the variables that it sets
  itself. funcd logs a warning for each key that it leaves out this way.
- A key that a bound Secret also holds is left out. The handler reads the Secret's value through `ctx.secret`
  instead, as the first example does with `SHARED`.
- While funcd's [S3 gateway](https://pyvvo.github.io/funcd/docs/develop/services/bucket.md) runs, a Function that binds a Bucket gets the
  `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` that funcd issues it, in place of a ConfigMap's values for these
  two keys.

## Read a setting through ctx.config

A handler can read its settings through `ctx.config`, the configuration client of the context that every handler
receives, instead of reading its environment. `ctx.config.get(key)` returns the key's value when a bound ConfigMap
holds the key and no exception of [Choose a ConfigMap's keys](#choose-a-configmaps-keys) leaves it out. For any other
key, such as `PATH`, it returns `undefined` in TypeScript and `None` in Python. `ctx.config.list()` returns the keys
that `get` returns a value for, sorted.

Both methods read the worker's environment and do not call funcd, so in TypeScript `get` returns the value itself,
not a Promise as `ctx.secret.get` does. The [Spec](https://pyvvo.github.io/funcd/docs/develop/workloads/configuration/spec.md#handler-api) tab lists both methods in each language.

## Define the settings in the Function

A Function can define a ConfigMap of its own under `spec.configMaps`: an entry with a `name` of at most 52 characters
and its `data`, in place of a `ref`. The Function `billing` defines and binds the ConfigMap `billing-settings`, so its
workers get `CURRENCY` set to `EUR` and `INVOICE_DAY` set to `1`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: billing
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: registry.example.com/billing:1.0.0
  configMaps:
    - name: billing-settings
      data:
        CURRENCY: EUR
        INVOICE_DAY: "1"
  bindings:
    config:
      - billing-settings
```

funcd creates that ConfigMap before the Function's first worker starts, under the name `<name>-<hash>`, where the hash
comes from the data, such as `billing-settings-<hash>`. The stored Function's `spec.bindings.config` shows that hashed
name. The ConfigMap belongs to the Function, and funcd deletes it with the Function.

Two Functions that define a ConfigMap with the same `name` and the same `data` would share one stored name. funcd
creates that ConfigMap for the first Function only. The second one waits in `Pending`, with the reason
`StoreNotOwned` and a message such as
`spec.configMaps[0]: ConfigMap "billing-settings-<hash>" exists and is not this Function's; bind it with ref`. To share
settings, define them in a ConfigMap of their own, as the next section shows.

## Share settings between Functions

Several Functions can bind the same ConfigMap: each one declares it by `ref` under `spec.configMaps`, as env-echo
does, and binds it under `spec.bindings.config`. This ConfigMap holds two settings that the Functions of an
application share:

```yaml
apiVersion: funcd.io/v1alpha1
kind: ConfigMap
metadata:
  name: shared-settings
  namespace: default
  resourceGroup: rg1
spec:
  data:
    LOG_LEVEL: info
    TIMEZONE: Europe/Paris
```

## Override a shared setting

When two ConfigMaps that a Function binds hold the same key, the worker gets the value of the ConfigMap listed later in
`spec.bindings.config`, within the exceptions of [Choose a ConfigMap's keys](#choose-a-configmaps-keys). The Function
`report` binds the shared ConfigMap first and a ConfigMap of its own second, so its workers get `LOG_LEVEL` set to
`debug` and `TIMEZONE` set to `Europe/Paris`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: report
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: registry.example.com/report:1.0.0
  configMaps:
    - ref: shared-settings
    - name: report-settings
      data:
        LOG_LEVEL: debug
  bindings:
    config:
      - shared-settings
      - report-settings
```

## Status

A ConfigMap has no status. A Function reports a problem with a ConfigMap that it binds or defines in its phase and its
conditions: `Ready`, and `RevisionReady` for its latest revision. `funcdctl get function env-echo -n default -o json`
prints them under `status`; with `funcdctl dev`, add the `--server` and `--token` flags that its banner prints.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| `Failed` | `ConfigResolveFailed` | No worker runs, and funcd starts none: a bound ConfigMap is missing, or holds a value that is not UTF-8 text or that holds a NUL byte. The message of the `Ready` condition names the ConfigMap, and the key for a bad value. Calls fail with the HTTP status 503. When the ConfigMap is missing, create it: funcd checks for it every `controller.referentPollInterval`, 2 seconds by default, and starts the workers once it exists. |
| `RevisionReady` condition | `ConfigResolveFailed` | The latest revision cannot start for one of the reasons of the `Failed` row, while a worker of the serving revision keeps the calls: the phase stays `Ready`. Fix or create the ConfigMap: funcd checks again every `runtime.supervisionPeriod`, 10 seconds by default. Once no worker is left, the Function is `Failed`. |
| `Pending` | `StoreNotOwned` | A ConfigMap that the Function defines exists under its stored name and does not belong to the Function, as [Define the settings in the Function](#define-the-settings-in-the-function) describes. Declare the shared settings by `ref`. |
| Another phase or reason | | The [Function's Status](https://pyvvo.github.io/funcd/docs/develop/workloads/function.md#status) explains it. |

## Changes and deletion

- A worker reads its settings when it starts and keeps them until it stops. A change to a ConfigMap that a Function
  names by `ref` therefore restarts nothing: only a worker that starts after the change gets the new values, such as
  a worker of the new [revision](https://pyvvo.github.io/funcd/docs/develop/workloads/function.md#changes-and-deletion) that funcd starts when the Function's spec
  changes.
- A change to the data of a ConfigMap that the Function defines is a change to the Function's spec. funcd creates the
  ConfigMap again under a new `<name>-<hash>` name and starts a new revision, whose workers start with the new values.
  Once the Function is `Ready` again, funcd deletes the old ConfigMap, unless another resource still names it.
- funcd does not refuse the deletion of a ConfigMap that a Function binds, and the deletion changes nothing at once:
  the Function stays `Ready`, and its running workers keep their values. funcd finds the ConfigMap missing when the
  Function next needs a new worker, such as when a worker stops or the spec changes, or, for a Function that shares
  its workers through [`spec.pooling`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecpooling), at the Function's next check. It then
  starts no new worker until the ConfigMap exists again, as [Status](#status) describes.
- Deleting a Function deletes the ConfigMaps that it defines. A ConfigMap that it names by `ref` stays.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no build of "<name>"` | Build the Function, and name its build `<name>.mjs`, after the Function, in the folder or its `dist` folder. The message names the paths that it looked at. |

## Run it locally

`funcdctl dev` applies each ConfigMap file of the folder when it starts, and applies a file again when the file
changes. It keeps one worker of each Function running, and that worker keeps the values that it started with, so it
does not see an edit of a ConfigMap that the Function names by `ref`: stop `funcdctl dev` and start it again to load
the edited values. A ConfigMap that the Function defines needs no restart, because a change to its data starts a new
revision at once. When a ConfigMap's file is removed, `funcdctl dev` deletes the ConfigMap, and the Function keeps
serving, as [Changes and deletion](#changes-and-deletion) describes.

## Examples

- [env-echo in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/env-echo): a Function that
  returns one setting from a ConfigMap and two values from a Secret.
