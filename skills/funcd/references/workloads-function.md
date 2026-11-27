# Function

Source: https://funcd.dev/docs/develop/workloads/function.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Read a Function's logs
- Write a handler and its contract
- Call another Function
- Serve HTTP requests
- Stream a response
- Take WebSocket connections
- Scale a Function to zero
- Access
- Limits and quotas
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Run a Function, call it, read its status and its logs, call one Function from another, serve HTTP, stream a response, take WebSocket connections, and scale to zero.

## Usage

A [Function](https://funcd.dev/docs/platform/workloads/function.md) is code that funcd runs when it is called: its **handler**
answers each call. This example runs log-burst, which takes events and returns `emitted`, the number of its log calls;
[Serve HTTP requests](#serve-http-requests) shows a Function that takes HTTP requests.

Install the [dev build of funcdctl](https://funcd.dev/docs/get-started/install.md), Git, curl, and Node.js, or Python 3.12 or later
as `python3`; with Docker or nerdctl instead, `funcdctl dev --containers` runs the Functions in containers and needs
neither. `funcdctl dev` runs each Function from the code in the folder, not from the manifest's `image`, the
[artifact](https://funcd.dev/docs/platform/workloads/artifacts.md) that [`funcdctl push`](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-push)
packs for a platform. `--gport` sets the port of the Function URLs, and `--cport` that of the control plane, which
`funcdctl` reaches with `--server` and the token `funcd-dev-token`.

### TypeScript

The manifest, `examples/log-burst/burst.yaml`:

```yaml
# log-burst: a Function whose handler writes more than 100 log lines at each call.
# funcd keeps each console call as a log record, which funcdctl logs prints.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: log-burst
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:log-burst   # funcdctl push log-burst.mjs (built from src/main.ts)
  replicas: 1
  scaling:
    minReplicas: 1
```

`funcdctl dev` runs the handler's build, `log-burst.mjs`, already in the repository:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/log-burst --gport 8080 --cport 8081
```

In another terminal, call the Function:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/log-burst
{"emitted":115}
```

The `funcdctl dev` terminal prints each log line. Read the Function's status:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token get function log-burst -n default -o json
```

Its `phase` is `Ready`. Keep the example running for [Read a Function's logs](#read-a-functions-logs).

### Python

The manifest, `examples/log-burst/handler.yaml`:

```yaml
# log-burst: a Function whose handler writes 100 log records at each call through logging. funcd keeps each
# logging call as a record with its level; a line printed to standard output becomes an INFO record, and one
# printed to standard error an ERROR record.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: log-burst
  namespace: default
  resourceGroup: rg1
spec:
  runtime: python314
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:log-burst   # the artifact that funcdctl push writes from src/main.py
  replicas: 1
  scaling:
    minReplicas: 1
```

`funcdctl dev` runs `src/main.py` as it is, since the folder has the Function's name:

```console
$ git clone https://github.com/pyvvo/funcd-python
$ cd funcd-python
$ funcdctl dev examples/log-burst --gport 8080 --cport 8081
```

In another terminal, call the Function:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/log-burst
{"emitted":100}
```

The `funcdctl dev` terminal prints each log line. Read the Function's status:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token get function log-burst -n default -o json
```

Its `phase` is `Ready`. Keep the example running for [Read a Function's logs](#read-a-functions-logs).

## Read a Function's logs

[`funcdctl logs`](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-logs) prints a Function's log records, the latest 1000 by
default: each `console`, `logging` or [`ctx.log`](https://funcd.dev/docs/develop/workloads/function/spec.md#handler-api) call, and each line of standard output as
`INFO` or of standard error as `ERROR`. A record appears within `funclog.segmentMaxAge`, 10 seconds by default, or
about a second under `funcdctl dev`, so repeat the command:

```console
$ funcdctl --server http://127.0.0.1:8081 --token funcd-dev-token logs log-burst -n default --severity error
2026-11-13T15:04:11.432Z [ERROR] 0 burst stderr default
2026-11-13T15:04:11.433Z [ERROR] 0 item failed
2026-11-13T15:04:11.433Z [ERROR] 0 item failed
2026-11-13T15:04:11.433Z [ERROR] 0 item failed
2026-11-13T15:04:11.433Z [ERROR] 0 item failed
```

`--since 15m` keeps a recent period, and `-o wide` adds attributes. Press Ctrl-C in the first terminal to stop.

## Write a handler and its contract

A Function's code exports the handler that the manifest's [`handler`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec) names, run by its
[`runtime`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec). A worker calls it with the context, through which it logs and reaches other
Functions and its stores, and the **event**: the call's JSON body arrives as `event.data` (`event["data"]` in Python),
unless the body is itself an event, as [Call another Function](#call-another-function) explains. The return value is
the response.

The **contract** file names the `runtime` and holds the JSON Schema of the input under `input` and of the result under
`output`. funcd refuses a call whose data does not match with 422, before the handler runs, and answers 500 when the
result does not match. log-burst's contract
([TypeScript](https://github.com/pyvvo/funcd-typescript/blob/main/examples/log-burst/log-burst.contract.yaml),
[Python](https://github.com/pyvvo/funcd-python/blob/main/examples/log-burst/log-burst.contract.yaml)) makes every
field optional, so the first call sends `{}`; a call with no body gets 422.

A contract uses only the JSON Schema that every runtime supports: objects with `properties` and
`additionalProperties: false`, maps, `{}` for any value, and `oneOf` with a `discriminator`. `funcdctl push` refuses
`$ref`, `anyOf`, `allOf`, `not` and `if`, and names what to use instead.

### TypeScript

The first example's handler:

```ts
// log-burst: each call logs at least 100 items with console.log, a warning every 10th item and an
// error every 25th, then returns how many console calls it made.
//
// Authored in TypeScript against @funcd-dev/shim; `yarn build` (vite.config.ts) bundles it to
// log-burst.mjs.
import type { CloudEvent, FunctionContext } from '@funcd-dev/shim';

export interface FuncInput {
  /** How many items to log; fewer than 100 still logs 100. */
  items?: number;
  /** A batch label echoed into the structured logs. */
  batch?: string;
  /** When set, one more log call carries a value of this many bytes, to show a record cut at the bound. */
  big?: number;
}
export interface FuncOutput {
  emitted: number;
}

export function handle(_ctx: FunctionContext, event: CloudEvent<FuncInput>): FuncOutput {
  const items = Math.max(100, event.data?.items ?? 100); // at least 100 items
  const batch = event.data?.batch ?? 'default';
  let emitted = 0;

  // a line on standard output becomes an INFO record, one on standard error an ERROR record.
  process.stdout.write(`burst stdout ${batch}\n`);
  process.stderr.write(`burst stderr ${batch}\n`);
  if (event.data?.big) {
    console.log('big value', { big: 'x'.repeat(event.data.big) });
    emitted++;
  }

  for (let i = 0; i < items; i++) {
    // INFO: the object argument becomes the record's attributes, which funcdctl logs -o wide shows.
    console.log('processing item', { i, batch });
    emitted++;

    // a WARN record every 10th item and an ERROR record every 25th.
    if (i % 10 === 0) {
      console.warn('slow item', { i, batch, latencyMs: 120 });
      emitted++;
    }
    if (i % 25 === 0) {
      console.error('item failed', { i, batch, reason: 'simulated' });
      emitted++;
    }
  }

  // a final summary record, at INFO.
  console.log('burst complete', { batch, emitted });
  emitted++;

  return { emitted };
}
```

To bundle a handler of your own,
[`@funcd-dev/vite-plugin`](https://github.com/pyvvo/funcd-typescript#bundle-your-functions) writes `dist/<name>.mjs`,
dependencies inlined, and copies `<name>.contract.yaml` beside it, where `funcdctl dev` finds them.

### Python

The first example's handler:

```py
"""log-burst: a funcd Function that writes a burst of log records.

It logs 90 INFO, 7 WARNING and 3 ERROR records through ``logging``, each with attributes from ``extra=``,
prints one line to standard output and one to standard error, and returns ``{"emitted": <count>}``, the number
of logging calls.
"""

from __future__ import annotations

import logging
import sys
from typing import TypedDict

from funcd_shim import CloudEvent, FunctionContext

# The records of this logger reach the root logger, where funcd takes them.
log = logging.getLogger("log-burst")

# How many records of each level to log: 90 INFO, 7 WARNING and 3 ERROR; the input's count adds INFO.
_BASE_INFO = 90
_WARNINGS = 7
_ERRORS = 3


class FuncInput(TypedDict, total=False):
    """The call's data, every key optional: ``count`` adds INFO records; ``big`` logs one value of that many
    bytes, to show a record cut at its size limit."""

    count: int
    big: int


class FuncOutput(TypedDict):
    """The response: how many logging calls the handler made."""

    emitted: int


def handle(context: FunctionContext, event: CloudEvent[FuncInput]) -> FuncOutput:
    """Emit a burst of ≥ 100 structured log records, then report the count."""
    data = event.get("data") or {}
    extra_info = max(int(data.get("count", 0)), 0)
    info_count = _BASE_INFO + extra_info

    # a line on standard output becomes an INFO record, one on standard error an ERROR record.
    print("burst stdout", flush=True)
    print("burst stderr", file=sys.stderr, flush=True)

    emitted = 0
    big = max(int(data.get("big", 0)), 0)
    if big:
        log.info("big value", extra={"big": "x" * big})
        emitted += 1
    for i in range(info_count):
        # the extra= fields become the record's attributes
        log.info("processing item %d", i, extra={"item": i, "phase": "scan"})
        emitted += 1
    for i in range(_WARNINGS):
        log.warning("slow item %d took %dms", i, 120 + i, extra={"item": i, "phase": "scan"})
        emitted += 1
    for i in range(_ERRORS):
        log.error("item %d failed validation", i, extra={"item": i, "phase": "validate"})
        emitted += 1

    return {"emitted": emitted}
```

`funcdctl dev` runs the handler where it is. To bundle it for `funcdctl push`,
[`funcd-bundle`](https://github.com/pyvvo/funcd-python/tree/main/bundle) writes `dist/<name>/` with the locked
dependencies and the contract. It needs a running Docker daemon for its import check, whenever the handler imports a
bundled dependency (`--no-check` skips it), and for `--hermetic`.

## Call another Function

A Function calls another of its [namespace](https://funcd.dev/docs/platform/tenancy-and-limits/namespaces.md) over a **link**
declared under [`spec.bindings.links`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindingslinks): an `alias` that its code uses and a `target`.
[`ctx.invoke`](https://funcd.dev/docs/develop/workloads/function/spec.md#handler-api) takes the alias and an input, and returns the target's result.

- An input with a top-level `data` or `specversion` key is the event itself; any other input becomes `event.data`.
- funcd checks the input against the target's contract. A failed call throws, or raises a `RuntimeError` in Python,
  with the HTTP status and the response.
- The target must exist when the caller is applied, and a link cannot close a cycle.
- A target that serves HTTP is called with [`ctx.fetch`](https://funcd.dev/docs/develop/workloads/function/spec.md#handler-api), in TypeScript only; `ctx.invoke`
  refuses it.
- An add-on object's engine is called through funcd, under an alias of
  [`spec.bindings.addon`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindings), with `ctx.addon.fetch`:
  [Call its engine from a Function](https://funcd.dev/docs/develop/services/addons.md#call-its-engine-from-a-function).
- A run of a Job is started and read through funcd, under an alias of
  [`spec.bindings.job`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindingsjob), with `ctx.job.start` and `ctx.job.get`:
  [Start a run from a Function](https://funcd.dev/docs/develop/workloads/job/start-from-a-function.md).

In the TypeScript example fn-to-fn, `front` calls `greeter` over this link
([complete file](https://github.com/pyvvo/funcd/blob/main/api/types/v1alpha1/examples/function/link.yaml)); the Python
method is also `invoke`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: front
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: registry.example.com/front:1.0.0
  bindings:
    links:
      - alias: greeter
        target: greeter
```

### TypeScript

The handler of `front` passes `{ data: { name } }`, so
[`greeter`](https://github.com/pyvvo/funcd-typescript/blob/main/examples/fn-to-fn/src/greeter/main.ts) gets `{ name }`:

```ts
import type { Handler } from '@funcd-dev/shim';

// A TYPE-only import of the callee's contract — erased at build, so front.mjs does NOT bundle
// greeter's code. It borrows greeter's input/output types so the invoke is type-checked, aliased
// because this module declares its OWN FuncInput/FuncOutput (its contract).
import type { FuncInput as GreeterInput, FuncOutput as GreeterOutput } from '../greeter/main.ts';

/**
 * What front accepts. `name` is OPTIONAL here (front is permissive) — so front can forward a payload
 * to greeter that greeter's stricter contract rejects, demonstrating that a target's 422 propagates
 * back through context.invoke.
 */
export interface FuncInput {
  name?: string;
}

/** What front returns — greeter's greeting, wrapped. */
export interface FuncOutput {
  via: string;
  greeting: string;
}

/**
 * front: the caller. Its Function declares a link under spec.bindings.links, with the alias greeter and
 * the target greeter, and the handler calls it with context.invoke. The link is the grant: without it,
 * context.invoke fails with 403. front forwards the caller's name as it is, so a missing name reaches
 * greeter, whose contract refuses it with 422, and the awaited invoke throws.
 */
export const handle: Handler<FuncInput, FuncOutput> = async (context, event) => {
  const reply = await context.invoke<{ data: GreeterInput }, GreeterOutput>('greeter', {
    data: { name: event.data?.name as string },
  });
  return { via: 'front', greeting: reply.greeting };
};
```

From the funcd-typescript repository, start the example:

```console
$ funcdctl dev examples/fn-to-fn --gport 8080 --cport 8081
```

In another terminal, call `front` with a name:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"ada"}' http://127.0.0.1:8080/function/front
{"via":"front","greeting":"Hello, ada!"}
```

`greeter`'s contract requires a `name`, so a call without one gets 422 from `greeter`, and `front`, which does not
catch the error, answers 500:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/front
{"error":"context.invoke(\"greeter\") failed: 422 {\"error\":\"event data does not match the input contract\",\"details\":[{\"path\":\"/name\",\"message\":\"missing property 'name'\"}]}"}
```

Press Ctrl-C in the first terminal to stop.

## Serve HTTP requests

A Function whose [`protocol`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec) is `http` gets each HTTP request, with its method, path, headers
and body, and answers as a web server does. It runs on Node.js, never shares a worker, and has no contract check: its
contract file names the `runtime` and `protocol: http`, with no `input` or `output`. Only funcd's
[edge](https://funcd.dev/docs/platform/security-and-networking/networking.md) and another Function's `ctx.fetch` reach it.

### TypeScript

The Function, in `examples/http-api/devices.yaml`:

```yaml
# devices-api: a Function that serves HTTP. Each request reaches its Hono app.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: devices-api
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  protocol: http
  image: oci-layout:///mnt/funcd-deps/registry:devices
  replicas: 1
  scaling:
    minReplicas: 1
```

Its handler wraps a [Hono app](https://github.com/pyvvo/funcd-typescript/blob/main/examples/http-api/src/app.ts) with
`http` from `@funcd-dev/shim`; a route reaches the context, with its bindings, as `c.env.funcd`:

```ts
// devices-api: a Function that serves HTTP. http(app) makes the Hono app its export, which the shim calls
// with every request under spec.protocol: http.
import { http } from '@funcd-dev/shim';

import { app } from './app.ts';

export const handle = http(app);
```

The app gets the path after the Function's address, such as `/devices` for `/function/devices-api/devices`, and the
removed part in `X-Forwarded-Prefix`. Start the example:

```console
$ funcdctl dev examples/http-api --gport 8080
```

In another terminal, create a device, then list the devices:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"name":"truck-7"}' http://127.0.0.1:8080/function/devices-api/devices
{"id":"1","name":"truck-7"}
$ curl -s http://127.0.0.1:8080/function/devices-api/devices
[{"id":"1","name":"truck-7"}]
```

The folder's [Route](https://funcd.dev/docs/develop/security-and-networking/networking/spec.md#route) `api` serves the same app at
`/api/devices`. Press Ctrl-C in the first terminal to stop.

## Stream a response

A Function that serves HTTP can answer a call through the edge with a stream, such as server-sent events (SSE): the
edge passes each chunk to the client as the app writes it. The Function's [`timeout`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec) bounds only
the wait for the response to start. Once it has started, funcd sets no limit on its length, and a stream that sends
nothing stays open. funcd cuts a stream only when funcd or the stream's worker stops, or when its client accepts no data
for 60 seconds while the app has data to send. Over a link, `ctx.fetch` returns the response whole, at most 1 MiB, so
it does not stream.

In TypeScript, Hono's [`streamSSE`](https://hono.dev/docs/helpers/streaming#streamsse) writes one: a route returns
`streamSSE(c, async (stream) => { … })`, whose `stream.writeSSE({ id, data })` sends an event, and `stream.aborted` turns
true once the client goes away.

- A proxy in front of funcd, such as a load balancer, a CDN or a tunnel, may close a stream that sends nothing for a
  while. Send an SSE comment line about every 30 seconds, `await stream.write(': ping\n\n')`, which a browser ignores.
- An open stream is a call in flight until it ends: it keeps its worker from going idle, and at a change of the
  Function it stays on the old worker, which funcd stops after `runtime.drainGrace`, 30 seconds by default. The client
  then sees the connection cut.
- A browser's `EventSource` reconnects by itself and reaches the new revision, with the `id` of the last event it got
  in the `Last-Event-ID` header, so the app can resume from there. A client that reads the stream with `fetch` must
  reconnect itself.

## Take WebSocket connections

A Function that serves HTTP takes WebSocket connections at its addresses, so both ends send at any time, such as a
phone remote and a TV page linked by a relay.

- The Function's [`timeout`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec) bounds only the handshake. A message holds at most 1 MiB, and a
  larger one closes its socket with code 1009.
- An open socket is a call in flight: it keeps its worker from going idle, and at a change of the Function it stays
  on the old worker, which funcd stops after `runtime.drainGrace`, 30 seconds by default. The socket then ends with
  no close frame, and the client must reconnect, which reaches the new revision.
- funcd closes a socket that carries no byte either way for 5 minutes, and a proxy in front may close one sooner, so
  send a ping or a message about every 30 seconds.
- With one replica, every socket of the Function meets on its one worker, so a relay can keep its sockets in memory;
  during a change they sit on two workers until the old one stops.

### TypeScript

A route made with `upgradeWebSocket` from `@funcd-dev/shim/ws` takes a socket, as Hono's own helper does on Node; that
entry needs Hono, and `@types/ws` for TypeScript. Each event runs in the context of the call that opened the socket:
`ctx.principal` is who opened it, and `ctx.remainingMs()` is `null`. The example's route `/relay` sends each message to
every other socket of the route:

```ts
.get(
  '/relay',
  // Each message goes to every other socket of the route (funcd ADR-0360), such as from a phone remote to a TV page.
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      relay.add(ws);
    },
    onMessage(event, ws) {
      for (const peer of relay) {
        if (peer !== ws && typeof event.data === 'string') peer.send(event.data);
      }
    },
    onClose(_event, ws) {
      relay.delete(ws);
    },
  })),
)
```

## Scale a Function to zero

A Function that sets neither [`replicas`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec) nor
[`scaling.minReplicas`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecscaling) runs no worker until its first call, which waits for a worker to
start: a **cold start**. With [`scaling.idleTimeout`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecscaling), funcd stops the workers after that
long without a call, and the Function is `Idle` until the next one. This Function stops after 5 minutes:

```yaml
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: pdf-render
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: registry.example.com/pdf-render:1.0.0
  scaling:
    idleTimeout: 5m
```

- funcd looks for idle Functions every [`invoke.reclaimInterval`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml), 30
  seconds by default, so workers can outlive `idleTimeout` by that much. A call in flight, an open stream or socket
  too, keeps the Function awake.
- A call waiting for a worker gets 503 after `invoke.activationTimeout`, 30 seconds by default; the calls that arrive
  during a start share that wait.
- `minReplicas` above 0 keeps that many workers, and the Function never goes `Idle`. `replicas` above 0 with
  `minReplicas` 0 starts workers before the first call, but after `Idle` only a call starts one again.
- Extra replicas are spares, not capacity: every call goes to the lowest-numbered worker that listens.

## Access

A Function calls the targets of its links with no role. For each call, funcd asks Cedar whether the caller may perform
`link::invoke` on the target, which this built-in policy allows in every namespace:

```cedar title="Built-in link policy"
@id("link-invoke-binding")
permit(principal, action == Action::"link::invoke", resource)
  when { principal has links && principal.links.contains(resource) };
```

- `ctx.invoke` and `ctx.fetch` reach only the caller's own links: an alias that no link declares fails with 403,
  whatever the role, with a message such as `caller default/front declares no link \"nope\" (no link is no grant)`. A
  namespace [Policy](https://funcd.dev/docs/develop/security-and-networking/security/spec.md#policy) can forbid a call that a link allows, also
  with 403.
- A client outside funcd calls through the edge, at `/function/<name>` or a Route, as
  [`spec.ingress`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecingress) allows. An [`auth.mode`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecingressauth) of
  `authenticated` needs `server.auth.edge: true` and a credential that may get the namespace's Functions, else 401 or
  403; under `funcdctl dev`, such an address answers 401.

## Limits and quotas

- A call through the edge carries at most 1 MiB, or gets 413, and must start its response within the Function's
  [`timeout`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec), or [`invoke.defaultTimeout`](https://funcd.dev/docs/develop/running-funcd/spec.md#funcdconfigyaml), 60
  seconds by default, a cold start included. Past it, the caller gets 504 while the handler goes on, so a retry can
  repeat its effects; a Python handler gets an exception a second later. A response that has started has no time
  limit: [Stream a response](#stream-a-response). [`ctx.remainingMs`](https://funcd.dev/docs/develop/workloads/function/spec.md#handler-api)
  (`remaining_ms`) returns the time left, or `null` with no deadline.
- A handler that blocks its worker, such as a loop that never awaits or a `time.sleep`, fails its liveness check, and
  funcd replaces the worker after `runtime.livenessTimeout`, 30 seconds by default.
- A call over a link waits up to the link's [`timeout`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecbindingslinks), 30 seconds by default and
  5 minutes at most, a cold start included, then fails with 503. Its input holds at most 1 MiB, or gets 413; a larger
  result gets 500 when the target's contract checks results, else 413, as through `ctx.fetch`.
- At most `invoke.maxNestedInFlight` link calls to one Function run at once, 10 by default; one more gets 429.
- [`resources`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspecresources) sets the CPU and memory of a Function's own workers, by default
  `functions.defaultResources`, 1 CPU and 512 MiB; only containerd enforces them, and kills a worker over its memory.
- A log record over `funclog.maxRecordBytes`, 64 KiB by default, is cut.

## Status

Read `status.phase` and the conditions with the first example's command. `Ready` says whether a worker serves,
`RevisionReady` whether the latest spec's revision serves, and `ShapeValid` whether its worker loaded the handler; each
phase row gives a reason of `Ready`.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| `Pending` | What the Function waits for, such as `KVStoreNotFound` or `SecretNotFound` | The Function waits, such as for a store or a Secret that it binds and that does not exist yet. It leaves `Pending` by itself once the wait is over. |
| `Deploying` | `ShimNotReady` | Workers are starting, and none serves yet, such as for a new Function or one that a call wakes. |
| `Ready` | | A worker is ready, and calls reach it. |
| `Idle` | `NoReplicas` | No worker runs. The next call starts one. |
| `Degraded` | `Restarting` | The Function has served, but no worker is ready now, such as while funcd replaces a worker that stopped. Calls wait for a ready worker. |
| `Failed` | `ShapeInvalid` | The handler cannot load, or the first worker did not become ready within `runtime.bootTimeout`, 1 minute by default. The Function stays `Failed` until its spec changes. |
| `Failed` | `RuntimeUnavailable` | The Function's runtime is missing. |
| `Failed` | `ArtifactUnresolved` | The image cannot be resolved. |
| `Failed` | `StartFailed` | A worker cannot start. funcd tries again after a growing wait. |
| `Failed` | Another reason, such as `NoMatchingPlatform`, `ContractMissing`, `ContractInvalid` or `ConfigResolveFailed` | The Function cannot run. The message of the `Ready` condition says why. |
| `Ready` condition | `CrashLoopBackOff` | A worker stopped before it listened, and funcd waits before it starts the worker again. |
| `RevisionReady` condition | `Progressing` | The revision of the latest spec is starting beside the serving one. |
| `RevisionReady` condition | `ShapeInvalid` | The revision of the latest spec cannot load its handler. After a change, the serving revision keeps the calls and the phase. |
| `ShapeValid` condition | `ShapeInvalid` | No worker of the latest spec has loaded the handler: the code has no export that `handler` names, the code fails to load, or no worker became ready within `runtime.bootTimeout`. The message gives the load error, or `the handler did not become ready within 1m0s` in the last case. |
| `IngressReady` condition | | Reports the Function's own Route. Only a Function whose `spec.ingress` sets a host or a path has it. |

funcd refuses the calls of a `Failed` Function at once with 503. `status.currentRevision` names the latest spec's
[revision](https://funcd.dev/docs/develop/workloads/function/spec.md#functionstatus).

## Changes and deletion

- funcd runs each version of a Function's spec as a **revision**, named after the Function and a growing number, such
  as `log-burst-2`; `funcdctl get revisions -n <namespace>` lists them.
- A new revision's workers start beside the serving ones and take the calls once all are ready. An old worker stops
  once idle, and is cut off after `runtime.drainGrace`, 30 seconds by default, with its open streams. A revision that
  cannot load its handler takes no call.
- A revision keeps the image digest of its creation, so push new code under a new tag, or set
  [`imageDigest`](https://funcd.dev/docs/develop/workloads/function/spec.md#functionspec).
- A delete stops the workers at once, cutting their calls, and removes the revisions, with a Lake or a
  [ConfigMap](https://funcd.dev/docs/develop/workloads/configuration.md) that the Function declares by `name`. A KVStore, Bucket or SQLDatabase that
  it declares by `name` stays, unless its `deletion` is `delete`.
- funcd refuses to delete the target of another Function's link; remove the link first.

## CLI errors

`funcdctl dev` stops at its start, before it serves any Function, when it meets one of these local errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. With Docker or nerdctl, `funcdctl dev --containers` needs no Node.js. |
| `no python interpreter found for the python handler` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. With Docker or nerdctl, `funcdctl dev --containers` needs no Python. |
| `cannot load the runtime shim (needs Python ≥3.12; set FUNCD_PYTHON)` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. With Docker or nerdctl, `funcdctl dev --containers` needs no Python. |
| `no build of "<name>"` or `no contract file for "<name>"` | Build the Function, or name its build and its contract file after it, where [Run it locally](#run-it-locally) says that `funcdctl dev` looks. The message names the paths that it looked at. |
| A Function's manifest and contract file `disagree on the runtime or protocol`. | Name the same `runtime` and `protocol` in both files. |
| A resource is in another namespace: `funcdctl dev runs namespace default only`. | Set the resource's namespace to `default`. |

## Run it locally

- `funcdctl dev` finds a Function's build by its name: `<name>.mjs`, in the folder or its `dist` folder, for Node.js;
  for Python, the entry that `[tool.funcd-bundle.functions]` of `pyproject.toml` names, else `src/main.py` in a folder
  of the Function's name, else `<name>.py`. The contract is `<name>.contract.yaml` or `<name>.contract.json`.
- A saved change to the build or the contract starts a new revision within about a second.
- It sets `replicas` and `scaling.minReplicas` to 1, so a Function never goes `Idle`.
- It runs workers as local processes, with no isolation or limits, prints their logs, runs the namespace `default`
  only, and its edge has no authenticator.
- Its data stays in memory unless [`--persist`](https://funcd.dev/docs/develop/tools/funcdctl/spec.md#funcdctl-dev) keeps it in `.funcd-dev`;
  delete that folder after it stops to start from nothing.

## Examples

- [log-burst in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/log-burst) and
  [in Python](https://github.com/pyvvo/funcd-python/tree/main/examples/log-burst): log lines and their count.
- [fn-to-fn in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/fn-to-fn): a call over a link.
- [http-api in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/http-api): HTTP with a web
  framework, a streamed export and a WebSocket relay.
