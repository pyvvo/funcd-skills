# Add-ons

Source: https://pyvvo.github.io/funcd/docs/develop/services/addons.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Call its engine from a Function
- Apply its settings
- Ship it with an App
- Upgrade it
- Back it up
- Sign users in through it
- Build one
- Access
- Limits and quotas
- Status
- Examples


Register an add-on built outside funcd, such as rauthy, declare its objects, call their engines from a Function, apply their settings, back them up and sign users in through them.

## Usage

An add-on is an engine built outside funcd that an admin registers on a running funcd. Its users then declare objects
of the kind it adds, as they declare a Lake: funcd runs one engine per object, serves it at the object's host, and
copies its data into the namespace's backups. The [Platform page](https://pyvvo.github.io/funcd/docs/platform/services/addons.md) explains how.
The add-ons funcd ships live in [pyvvo/funcd-addons](https://github.com/pyvvo/funcd-addons). This page uses rauthy, an
OpenID Connect provider of kind `IdentityProvider`.

The server's `addons.registries` must list the registry of the add-on's image, `ghcr.io` for rauthy. An admin then
registers the add-on from a release, piping its manifest to `funcdctl apply -f -`:

```sh
curl -fsSL https://github.com/pyvvo/funcd-addons/releases/download/v0.2.0/rauthy.yaml | funcdctl apply -f -
```

The Addon names the kind, the engine's image pinned by digest, its port and readiness path, its storage, and the schema
of its objects' `spec.config`; this one is shortened from rauthy's
([complete file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/addons/addon.yaml)):

```yaml
apiVersion: funcd.io/v1alpha1
kind: Addon
metadata:
  name: rauthy
spec:
  kind: IdentityProvider
  image: ghcr.io/pyvvo/funcd-rauthy@sha256:7686fef5edcb27399e23f8386fecb03b13f909966d2c3c4708095e2c31ccfe2d
  runtimes:
    - containerd
  port: 8080
  basePath: /auth/v1
  privatePaths:
    - /auth/v1/clients_dyn
  readiness:
    path: /auth/v1/ping
  storage:
    path: /app/data
    uid: 10001
    gid: 10001
  config:
    type: object
    additionalProperties: false
    properties:
      publicHost:
        type: string
      https:
        type: boolean
    required:
      - publicHost
      - https
  env:
    PUB_URL: ${{ config.publicHost }}
    PROXY_MODE: '${{ config.https ? "true" : "false" }}'
  secretKeys:
    - ENC_KEYS
    - ENC_KEY_ACTIVE
  snapshot:
    path: /app/data/state_machine/backups
  restore:
    path: /app/data/restore
    env:
      HQL_BACKUP_RESTORE: ${{ "file:" + restore.file }}
  settings:
    - kind: RauthyPasswordPolicy
      target: spec.config.provider
      resync: 10m
      function:
        ref: rauthy-settings
      schema:
        type: object
        additionalProperties: false
        properties:
          provider:
            type: string
          lengthMin:
            type: integer
            minimum: 8
        required:
          - provider
          - lengthMin
      constraints:
        count:
          perTarget: 1
        immutable:
          - spec.config.provider
```

A user writes the Secret its objects bind with rauthy's plugin, then declares an identity provider
([complete file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/addons/addonobject.yaml)):

```yaml
apiVersion: funcd.io/v1alpha1
kind: IdentityProvider
metadata:
  name: login
  namespace: default
  resourceGroup: default
spec:
  config:
    publicHost: login.example.com
    https: true
  bindings:
    secret:
      - rauthy-keys
  ingress:
    host: login.example.com
```

```sh
funcdctl rauthy keys --admin-email admin@example.com -n default
funcdctl apply -f identityprovider.yaml
funcdctl get identityproviders -n default
```

funcd checks `spec.config` against the add-on's schema when the object is applied. The object turns `Ready` once its
engine answers on its readiness path, and the edge then serves it at `login.example.com` under `/auth/v1`.

## Call its engine from a Function

A Function reaches an add-on object's engine through funcd only, under an alias of
[`spec.bindings.addon`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecbindings). The binding names an object of the
Function's namespace; a Function of an App binds only an object its App declares, by name or by ref. The Function
waits in `Pending` with `AddonObjectNotFound` while the object does not exist.

[`ctx.addon.fetch`](https://pyvvo.github.io/funcd/docs/develop/services/addons/spec.md#handler-api) sends a request to the engine and returns its answer, whatever its status, as a
`Response` in TypeScript and an `AddonResponse` in Python. funcd follows no redirect, and drops the forwarding headers
and every `X-Funcd-*` header both ways. A call funcd refuses throws, or raises a `RuntimeError` in Python, with its
status and its problem. Any HTTP client can call the engine too, at `FUNCD_ADDON_<ALIAS>_URL`, the add-on proxy, with
the header `X-Funcd-Addon-Token` set to `FUNCD_ADDON_<ALIAS>_TOKEN`; the proxy drops the token before the engine.

The Function `addon-caller` of the lane example binds the object `echo`, a whoami engine that answers the headers it
gets, and calls it both ways
([complete file](https://github.com/pyvvo/funcd-functions/blob/main/apps/addon-caller/fixtures/addon-caller.yaml)):

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: addon-caller
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry/addon-caller:1.0.0
  bindings:
    addon:
      - alias: echo
        object: echo
```

```mjs
// The caller of funcd's addon-rauthy-signin lane (funcd ADR-0338): it binds the add-on object echo, a traefik/whoami
// engine that answers the headers it gets, and calls it through ctx.addon.fetch and through the add-on proxy, asks for
// a path the object keeps private, and dials the engine's own address, which funcd's fence refuses.

export const handle = async (ctx, event) => {
  const { address } = event.data ?? {};
  const viaFetch = await ctx.addon.fetch('echo', '/', { headers: { 'X-Lane': 'fetch' } });
  const proxy = await fetch(`${process.env.FUNCD_ADDON_ECHO_URL}/`, {
    headers: { 'X-Funcd-Addon-Token': process.env.FUNCD_ADDON_ECHO_TOKEN, 'X-Lane': 'proxy' },
  });
  let kept;
  try {
    kept = (await ctx.addon.fetch('echo', '/private')).status;
  } catch (err) {
    kept = err.status ?? String(err);
  }
  let dial;
  try {
    dial = (await fetch(`http://${address}/`, { signal: AbortSignal.timeout(3000) })).status;
  } catch {
    dial = 'refused';
  }
  return {
    fetch: { status: viaFetch.status, body: await viaFetch.text() },
    proxy: { status: proxy.status, body: await proxy.text() },
    private: kept,
    dial,
  };
};
```

A path that the object's Addon keeps private is refused with 404, and so is a path outside its `basePath`, as at the
edge. The Function's own dial of the engine's address is refused: only funcd reaches an engine.

## Apply its settings

An Addon can add settings kinds. An object of one runs no engine and names its target, an object of the Addon's kind:
rauthy's `RauthyPasswordPolicy` holds the password policy of one IdentityProvider. funcd checks each write against the
kind's schema and its constraints, here one policy per IdentityProvider. It then sends each target's full list of
objects to the kind's Function, `rauthy-settings`, which applies the list through its binding of the target
([complete file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/addons/settings.yaml)):

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: rauthy-settings
  namespace: default
  resourceGroup: default
spec:
  runtime: nodejs22
  handler: reconcile
  image: registry.example.com/rauthy-settings:0.2.0
  bindings:
    addon:
      - alias: idp
        object: login
```

```yaml
apiVersion: funcd.io/v1alpha1
kind: RauthyPasswordPolicy
metadata:
  name: strict
  namespace: default
  resourceGroup: default
spec:
  config:
    provider: login
    lengthMin: 16
```

funcd calls the Function at each change of a target's list, after a failed call's backoff, and at the kind's
`resync`, so a setting changed at the engine's own API is put back. Each call is a CloudEvent of type
`funcd.addon.settings`, whose data holds the kind, the cause, the target with the alias that binds it, and each
object's name, uid, generation and config. The answer holds a result per object: `ok`, or a reason and a message.
With no object left, the list is empty, and the Function puts the engine's default back. rauthy's Function puts the
policy with rauthy's API key `settings`, which `funcdctl rauthy keys` has rauthy create at its first start:

```mjs
// The Function of rauthy's settings kind RauthyPasswordPolicy (funcd ADR-0341): funcd sends it every policy that names
// one IdentityProvider, and it puts that policy into rauthy through its binding of the IdentityProvider (funcd
// ADR-0338), or rauthy's default when the list is empty. rauthy holds one policy per instance, so the kind allows one
// per IdentityProvider. It signs in with the API key settings, which funcdctl rauthy keys has rauthy create.

const DEFAULT = {
  length_min: 14,
  length_max: 128,
  include_lower_case: 1,
  include_upper_case: 1,
  include_digits: 1,
  include_special: null,
  valid_days: 180,
  not_recently_used: 3,
};

const request = (c) => ({
  length_min: c.lengthMin,
  length_max: c.lengthMax,
  include_lower_case: c.lowerCase ?? null,
  include_upper_case: c.upperCase ?? null,
  include_digits: c.digits ?? null,
  include_special: c.special ?? null,
  valid_days: c.validDays ?? null,
  not_recently_used: c.notRecentlyUsed ?? null,
});

const all = (objects, result) => ({ results: objects.map((o) => ({ name: o.name, ...result })) });

export const reconcile = async (ctx, event) => {
  const call = event.data;
  const objects = call.objects ?? [];
  const secret = await ctx.secret.get('BOOTSTRAP_API_KEY_SECRET');
  const policy = objects.length > 0 ? request(objects[0].config) : DEFAULT;
  let res;
  try {
    res = await ctx.addon.fetch(call.target.alias, '/auth/v1/password_policy', {
      method: 'PUT',
      headers: { Authorization: `API-Key settings$${secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(policy),
    });
  } catch (err) {
    return all(objects, { ok: false, reason: 'EngineUnreachable', message: String(err?.message ?? err) });
  }
  if (!res.ok) {
    const text = (await res.text()).slice(0, 300);
    return all(objects, { ok: false, reason: 'EngineRefused', message: `rauthy answered ${res.status}: ${text}` });
  }
  return all(objects, { ok: true });
};
```

A target may name its own Function for a kind in `spec.functions`, in place of the kind's, so two copies of an App
template in one namespace each apply their own.

## Ship it with an App

An App template can carry the add-on with the Functions, values and hooks that run beside it: its `addon.yaml` holds the
Addon, which an admin's `funcdctl app deploy` registers or updates before the App, and the App's `addons` section holds
the objects of its kind. rauthy's template holds an IdentityProvider `<app>-login` and its own settings Function
`<app>-settings`, which the IdentityProvider names for its policies:

```yaml
secrets:
  - name: ${{ values.keys }}
    keys:
      - BOOTSTRAP_API_KEY_SECRET
addons:
  - name: ${{ app.name + "-login" }}
    kind: IdentityProvider
    config:
      publicHost: '${{ values.publicHost !== "" ? values.publicHost : values.host }}'
      rpId: ${{ values.host }}
      https: ${{ values.https }}
    bindings:
      secret:
        - ${{ values.keys }}
    ingress:
      host: ${{ values.host }}
    functions:
      - kind: RauthyPasswordPolicy
        ref: ${{ app.name + "-settings" }}
functions:
  - name: ${{ app.name + "-settings" }}
    runtime: nodejs22
    handler: reconcile
    image: ${{ images.settings }}
    bindings:
      addon:
        - alias: idp
          object: ${{ app.name + "-login" }}
      secret:
        - ${{ values.keys }}
```

```sh
funcdctl push settings/rauthy-settings.mjs <registry>/rauthy-settings:0.2.0
funcdctl app lock app -f values.yaml
funcdctl push --template app <registry>/rauthy:0.2.0
funcdctl app deploy <registry>/rauthy:0.2.0 -f values.yaml --name web-auth
```

A developer's deploy of the template needs the kind registered already; [Carry an
add-on](https://pyvvo.github.io/funcd/docs/develop/workloads/app.md#carry-an-add-on) shows the rest.

## Upgrade it

An admin's change of an Addon stamps a revision, an AddonRevision named after the Addon and its generation, such as
`rauthy-2`, and replaces no engine: each object keeps running the revision that `status.addonRevision` names. An edit
of the object moves it to the Addon's current revision, and an App's next revision moves its parts, its hooks around
the move. An admin lists the revisions with `funcdctl get addonrevisions`; funcd removes one that no object pins and no
App's revision records. Under `funcdctl dev`, every object follows the current revision at once.

## Back it up

A BackupSchedule copies an add-on object when its scope names it under `addons`, and an App's scope copies its `addons`
parts: each Backup copies the newest copy that the engine wrote of its own data. A Restore of an add-on object is in
place only. funcd restarts the engine with the copy, then again without it, and holds the namespace meanwhile.

## Sign users in through it

An `OIDCProvider` with `client.registration` has funcd register the edge's sign-in client at the provider, and its
`addon`, naming the IdentityProvider, has funcd reach rauthy at the engine's own address. A Route whose `auth.mode` is
`oidc` then signs its callers in, and the code behind it reads who signed in:
[Sign users in](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#sign-users-in).

## Build one

[pyvvo/funcd-addons' rauthy](https://github.com/pyvvo/funcd-addons/tree/main/rauthy) is a complete add-on to build
from: its Addon and App template, its settings Function, its examples and its funcdctl plugin. [Build an
add-on](https://pyvvo.github.io/funcd/docs/develop/services/addons/build.md) shows what an engine must do and how rauthy's parts are written.

## Access

Only an admin registers, changes or deletes an Addon, and only an admin reads its AddonRevisions. A developer of a
namespace declares the objects of an add-on's kind there.

A Function calls the engines of the objects it binds with no role. For each call, funcd asks Cedar whether the Function
may perform `addon::call` on the object, which this built-in policy allows:

```cedar title="Built-in add-on call policy"
@id("addon-call-binding")
permit(principal, action == Action::"addon::call", resource)
  when { principal has addonBindings && principal.addonBindings.contains(resource) };
```

A namespace [Policy](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security/spec.md#policy) can forbid a call that a binding allows,
with 403. An alias the Function does not bind, and a proxy request with no token or a token of no Function, are 403 too.

## Limits and quotas

- A namespace holds at most `addons.maxObjectsPerNamespace` objects that run an engine, 20 by default, all add-ons
  together, and at most `addons.maxSettingsPerNamespace` settings objects, 200 by default.
- A call of an engine waits `addons.callTimeout` for the answer, 10 seconds by default, then fails with 503. Its request
  body and its answer body hold at most `addons.callPayloadLimit` bytes each, 1 MiB by default, or the call fails with
  413.
- A call of a settings kind's Function waits `addons.settingsTimeout`, 30 seconds by default, then fails, and funcd
  calls again after 1 second, then twice as long after each failure, at most 5 minutes or the kind's resync.

## Status

```sh
funcdctl get identityproviders login -n default -o json
funcdctl get rauthypasswordpolicys strict -n default -o json
funcdctl logs identityprovider/login -n default
```

`funcdctl logs` prints what the object's engine wrote, both streams at INFO, to whoever may read the object. Under
`funcdctl dev`, the lines also go to the log file that dev prints as the container starts, and never to its terminal.

| Object | Reason | Meaning |
| --- | --- | --- |
| An object that runs an engine | `EngineNotReady` | The engine does not answer its readiness path yet |
| | `AddonNotFound` | No Addon registers its kind |
| | `ConfigInvalid`, `EnvInvalid` | Its config no longer fits the Addon's schema, or its env does not evaluate |
| | `SecretNotFound`, `BindingResolveFailed` | A bound Secret is missing or forbidden |
| | `RuntimeUnavailable` | The server runs no engine of the add-on's runtime |
| A settings object | `Progressing` | No answer of its Function for its generation yet |
| | `ReconcileFailed`, `NoResult` | The call failed, or its answer left the object out; the Function's own reason when it gives one |
| | `TargetNotFound`, `TargetNotReady` | Its target is missing or not Ready |
| | `FunctionNotFound`, `FunctionNotBound` | Its Function is missing, or does not bind its target |
| A Function that binds an object | `AddonObjectNotFound` | The object does not exist |
| | `DependencyNotReady` | A worker is not ready: the object's engine is not Ready |

## Examples

- [rauthy](https://github.com/pyvvo/funcd-addons/tree/main/rauthy): the add-on, its template and its settings Function,
  which the `addon-rauthy` lanes register, deploy and apply.
- [addon-caller](https://github.com/pyvvo/funcd-functions/tree/main/apps/addon-caller): a Function that calls an add-on
  object's engine, which the `addon-rauthy-signin` lane runs.
