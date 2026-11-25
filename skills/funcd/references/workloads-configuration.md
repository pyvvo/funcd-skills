# Configuration

Source: https://funcd.dev/docs/develop/workloads/configuration.md (the Markdown copy of the page; prefer it when the network is up).

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

A [ConfigMap](https://funcd.dev/docs/platform/workloads/configuration.md) holds settings that are not secret as string keys. Each
[worker](https://funcd.dev/docs/platform/workloads.md#runtime) of a Function that binds it gets its keys as environment
variables when it starts. A Function declares a ConfigMap under
[`spec.configMaps`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecconfigmaps) and binds it under
[`spec.bindings.config`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindings); a binding names only a ConfigMap that its Function,
or its App, declares.

Install the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git and curl, and put Node.js on the `PATH`. The
env-echo example returns one ConfigMap setting and two Secret values.

### TypeScript

The ConfigMap, in `configmap.yaml`:

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

The Function, in `function.yaml`, also binds the Secret
[`app-secret`](https://github.com/pyvvo/funcd-typescript/blob/main/examples/env-echo/secret.yaml):

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

Start the example:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/env-echo --gport 8080
```

In another terminal, call it:

```console
$ curl -s -X POST http://127.0.0.1:8080/function/env-echo
{"config":"prod","secret":"s3cr3t","shared":"from-secret"}
```

The handler reads `APP_MODE` from its environment, and the Secret through
[`ctx.secret`](https://funcd.dev/docs/develop/services/secrets.md):

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

`shared` comes from the Secret: a key that a bound Secret also holds does not reach the environment. Press Ctrl-C in
the first terminal to stop.

## Choose a ConfigMap's keys

A key is an environment variable name: ASCII letters, digits and `_`, not starting with a digit. A worker gets every
key of its bound ConfigMaps, except:

- a key that starts with `FUNCD_`, which funcd reserves, with a warning in its log;
- a key that a bound Secret also holds, which the handler reads through `ctx.secret`;
- `AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY` of a Function that binds a Bucket while the
  [S3 gateway](https://funcd.dev/docs/develop/services/bucket.md) runs, which funcd sets itself.

## Read a setting through ctx.config

[`ctx.config.get(key)`](https://funcd.dev/docs/develop/workloads/configuration/spec.md#handler-api) returns a key that a bound ConfigMap delivers, and `undefined` or `None`
for any other key, such as `PATH`; `ctx.config.list()` returns those keys, sorted. Both read the worker's environment,
so in TypeScript `get` returns the value itself, not a Promise.

## Define the settings in the Function

An entry of `spec.configMaps` with a `name` of at most 52 characters and its `data` defines a ConfigMap of the
Function's own:

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

funcd creates it as `<name>-<hash>`, the hash of its data, before the first worker starts, and deletes it with the
Function. Two Functions that define the same `name` and `data` would share that name: the second waits in `Pending`
with `StoreNotOwned`. Share settings through a ConfigMap of their own instead.

## Share settings between Functions

Several Functions declare the same ConfigMap by `ref` and bind it:

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

When two bound ConfigMaps hold the same key, the one listed later in `spec.bindings.config` wins:

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

A ConfigMap has no status; the Function that binds or defines it reports a problem.
`funcdctl get function env-echo -n default -o json` prints it; with `funcdctl dev`, add the `--server` and `--token`
flags of its banner.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| `Failed` | `ConfigResolveFailed` | No worker runs, and funcd starts none: a bound ConfigMap is missing, or holds a value that is not UTF-8 text or that holds a NUL byte. The message of the `Ready` condition names the ConfigMap, and the key for a bad value. Calls fail with the HTTP status 503. When the ConfigMap is missing, create it: funcd checks for it every `controller.referentPollInterval`, 2 seconds by default, and starts the workers once it exists. |
| `RevisionReady` condition | `ConfigResolveFailed` | The latest revision cannot start for one of the reasons of the `Failed` row, while a worker of the serving revision keeps the calls: the phase stays `Ready`. Fix or create the ConfigMap: funcd checks again every `runtime.supervisionPeriod`, 10 seconds by default. Once no worker is left, the Function is `Failed`. |
| `Pending` | `StoreNotOwned` | A ConfigMap that the Function defines exists under its stored name and does not belong to the Function, as [Define the settings in the Function](#define-the-settings-in-the-function) describes. Declare the shared settings by `ref`. |
| Another phase or reason | | The [Function's Status](https://funcd.dev/docs/develop/workloads/function.md#status) explains it. |

## Changes and deletion

- A worker keeps the settings that it started with, so a changed ConfigMap reaches only workers that start later,
  such as those of a [new revision](https://funcd.dev/docs/develop/workloads/function.md#changes-and-deletion).
- Changing a defined ConfigMap changes the Function's spec: funcd creates it under a new hash and starts a new
  revision, then deletes the old ConfigMap unless another resource names it.
- Deleting a bound ConfigMap changes nothing at once. funcd notices when the Function next needs a worker, and then
  starts none until the ConfigMap exists again.
- Deleting a Function deletes the ConfigMaps that it defines, not those that it names by `ref`.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no build of "<name>"` | Build the Function, and name its build `<name>.mjs`, after the Function, in the folder or its `dist` folder. The message names the paths that it looked at. |

## Run it locally

`funcdctl dev` applies a ConfigMap file when it starts and when the file changes, but a running worker keeps its
values: restart `funcdctl dev` after editing a ConfigMap named by `ref`. A defined ConfigMap needs no restart, since its
change starts a new revision.

## Examples

- [env-echo in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/env-echo): one setting from a
  ConfigMap and two values from a Secret.
