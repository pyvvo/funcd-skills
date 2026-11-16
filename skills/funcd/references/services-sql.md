# SQL

Source: https://pyvvo.github.io/funcd/docs/develop/services/sql.md (the Markdown copy of the page; prefer it when the network is up).

## Contents

- Usage
- Call ctx.sql without a query builder
- Access
- Limits and quotas
- Data storage
- Status
- Changes and deletion
- CLI errors
- Run it locally
- Examples


Declare a SQL database, bind it to a Function, and run SQL statements on it from the handler through ctx.sql.

## Usage

A [SQLDatabase](https://pyvvo.github.io/funcd/docs/platform/services/sql.md) has an engine of its own, rqlite, which keeps the data in SQLite,
so statements use SQLite's dialect. A Function binds the database and sends statements through
[`ctx.sql`](https://pyvvo.github.io/funcd/docs/develop/services/sql/spec.md#handler-api).

The first example, sql-notes in TypeScript or sql-orders in Python, creates the tables with a migration Function, then
adds and lists rows through the database's **owner**, the Function that can write it. The migration Function writes
through the role `SQL Data Writer`, given in `grant.yaml`. Each Function declares the database under
[`spec.sql`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecsql) and binds it under
[`spec.bindings.sql`](https://pyvvo.github.io/funcd/docs/develop/workloads/function/spec.md#functionspecbindingssql), which allows reading; the handler
passes the binding's alias to `ctx.sql`.

Install Git, curl and the [dev build of funcdctl](https://pyvvo.github.io/funcd/docs/get-started/install.md), which includes the SQL engine, and
put Node.js, or [uv](https://docs.astral.sh/uv/) for Python, on the `PATH`. `funcdctl dev` starts an engine per
database and logs `dev sql engine ready` once it answers; a call sent before waits, and fails after
`invoke.activationTimeout`, 30 seconds by default. The data is deleted when `funcdctl dev` stops, unless
[`--persist`](#run-it-locally) keeps it.

### TypeScript

The folder holds the built handlers, so there is no build step:

```console
$ git clone https://github.com/pyvvo/funcd-typescript
$ cd funcd-typescript
$ funcdctl dev examples/sql-notes --gport 8080
```

In another terminal, apply the migrations, add a note, and list the notes:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/notes-migrate
{"applied":2}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"add","notebook":"shopping","title":"milk"}' http://127.0.0.1:8080/function/notes
{"note":{"id":1,"title":"milk"}}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"list"}' http://127.0.0.1:8080/function/notes
{"notes":[{"id":1,"notebook":"shopping","title":"milk","done":false,"priority":0}]}
```

The database records its migrations, so a second call applies none:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/notes-migrate
{"applied":0}
```

Press Ctrl-C in the first terminal to stop.

The SQLDatabase, in `notes-db.yaml`:

```yaml
# SQLDatabase notes-db: the notes database. Its owner, notes, writes it, and notes-migrate does through grant.yaml.
apiVersion: funcd.io/v1alpha1
kind: SQLDatabase
metadata:
  name: notes-db
  namespace: default
  resourceGroup: rg1
spec:
  owner: notes
```

The Function `notes`, in `notes.yaml`; `notes-migrate.yaml` declares and binds the database the same way:

```yaml
# Function notes, the owner of notes-db: spec.bindings.sql binds it as the alias app.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: notes
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:notes
  sql:
    - ref: notes-db
  bindings:
    sql:
      - alias: app
        database: notes-db
```

The handler of `notes-migrate`: `applyMigrations`, from `@funcd-dev/drizzle`, applies the migrations that `_migrations`
does not record, with their records, in one `ctx.sql.execute` call:

```ts
// The notes-migrate function: it brings notes-db to the schema of src/db/schema.ts. Run it once after each deploy, or as an
// App's preApply hook. It writes notes-db through a SQL Data Writer grant (grant.yaml).
import type { FunctionContext } from '@funcd-dev/shim';

import { applyMigrations } from '@funcd-dev/drizzle';

// The paths are relative to this file, src/notes-migrate/, so drizzle/ is two levels up.
const files: Record<string, string> = import.meta.glob(['../../drizzle/*.sql', '../../drizzle/meta/_journal.json'], {
  query: '?raw',
  import: 'default',
  eager: true,
});

export interface FuncOutput {
  applied: number;
}

export async function handle(ctx: FunctionContext): Promise<FuncOutput> {
  const applied = await applyMigrations(ctx, files);
  ctx.log('applied', applied, 'migrations');
  return { applied };
}
```

The handler of `notes` uses Drizzle through `funcdDrizzle`. Its operations `add` and `list`, excerpts of
[`src/notes/main.ts`](https://github.com/pyvvo/funcd-typescript/blob/main/examples/sql-notes/src/notes/main.ts):

```ts
case 'add': {
  const id = await notebookId(d, input.notebook ?? 'inbox');
  const [note] = await d
    .insert(notes)
    .values({ notebookId: id, title: input.title ?? '', priority: input.priority ?? 0 })
    .returning({ id: notes.id, title: notes.title });
  return { note };
}
```

```ts
default: {
  const rows = await d
    .select({
      id: notes.id,
      notebook: notebooks.name,
      title: notes.title,
      done: notes.done,
      priority: notes.priority,
    })
    .from(notes)
    .innerJoin(notebooks, eq(notes.notebookId, notebooks.id))
    .where(input.notebook ? eq(notebooks.name, input.notebook) : undefined)
    .orderBy(desc(notes.priority), asc(notes.id));
  return { notes: rows };
}
```

### Python

`uv run` installs the example's packages into `.venv` and starts `funcdctl dev` with that environment's `python3`:

```console
$ git clone https://github.com/pyvvo/funcd-python
$ cd funcd-python/examples/sql-orders
$ uv run funcdctl dev . --gport 8080
```

In another terminal, apply the migrations, place an order, and list the orders:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/orders-migrate
{"applied":2}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"place","email":"ada@example.org","item":"tea","quantity":2}' http://127.0.0.1:8080/function/orders
{"changed":1}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"list"}' http://127.0.0.1:8080/function/orders
{"orders":[{"id":1,"email":"ada@example.org","item":"tea","quantity":2,"status":"placed","note":null}]}
```

The database records its migrations, so a second call applies none:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{}' http://127.0.0.1:8080/function/orders-migrate
{"applied":0}
```

Press Ctrl-C in the first terminal to stop.

The SQLDatabase, in `orders-db.yaml`:

```yaml
# SQLDatabase orders-db: the orders database, written by its owner, orders, and by orders-migrate and audit
# through the RolesAssignment of grant.yaml.
apiVersion: funcd.io/v1alpha1
kind: SQLDatabase
metadata:
  name: orders-db
  namespace: default
  resourceGroup: rg1
spec:
  owner: orders
```

The Function `orders`, in `orders.yaml`; `orders-migrate.yaml` and `audit.yaml` declare and bind the database the same
way:

```yaml
# Function orders, the owner of orders-db: spec.bindings.sql binds it as the alias app.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: orders
  namespace: default
  resourceGroup: rg1
spec:
  runtime: python314
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:orders
  sql:
    - ref: orders-db
  bindings:
    sql:
      - alias: app
        database: orders-db
```

The handler of `orders-migrate` applies the migrations that `_migrations` does not record, with their records, in one
`context.sql.execute` call:

```py
"""The orders-migrate function: it applies the migrations of migrations_sql that table _migrations lacks, each
with its _migrations row, in one context.sql call, so a failed migration records nothing. Run it after each
deploy, or as an App's preApply hook."""

from typing import TypedDict

from funcd_shim import CloudEvent, FunctionContext
from orders_core.migrations_sql import MIGRATIONS
from orders_core.sqlrun import ALIAS


class FuncOutput(TypedDict):
    applied: int


def handle(context: FunctionContext, event: CloudEvent[object]) -> FuncOutput:
    context.sql.execute(ALIAS, "CREATE TABLE IF NOT EXISTS _migrations (version TEXT PRIMARY KEY)")
    done = {r["version"] for r in context.sql.query(ALIAS, "SELECT version FROM _migrations")}
    batch: list[str | tuple[str, list[str]]] = []
    pending = [v for v in MIGRATIONS if v not in done]
    for version in pending:
        batch += MIGRATIONS[version]
        batch.append(("INSERT INTO _migrations (version) VALUES (?)", [version]))
    if batch:
        context.sql.execute(ALIAS, batch)
    context.log("applied", len(pending), "migrations")
    return {"applied": len(pending)}
```

The handler of `orders` uses SQLModel. Its operations `place`, which adds the customer and the order in one call, and
`list`, excerpts of
[`src/orders/main.py`](https://github.com/pyvvo/funcd-python/blob/main/examples/sql-orders/src/orders/main.py):

```py
def _place(context: FunctionContext, data: FuncInput) -> FuncOutput:
    """Adds the customer on its first order and the order itself in one call: both or neither."""
    email = data.get("email", "")
    customer = select(Customer.id).where(Customer.email == email).scalar_subquery()
    execute(
        context,
        insert(Customer).values(email=email).prefix_with("OR IGNORE"),
        insert(Order).values(
            customer_id=customer, item=data.get("item", ""), quantity=data.get("quantity", 1), status="placed"
        ),
    )
    return {"changed": 1}


```

```py
stmt = (
    select(Order, Customer.email)
    .join(Customer, col(Customer.id) == col(Order.customer_id))
    .order_by(col(Order.id))
)
if "email" in data:
    stmt = stmt.where(Customer.email == data["email"])
found = rows(context, stmt)
keys = ("id", "email", "item", "quantity", "status", "note")
return {"orders": [OrderOut(**{k: r[k] for k in keys}) for r in found]}  # type: ignore[typeddict-item]
```

`audit`, which also holds the writer role, records each change of `orders`: `changes.yaml` turns the database's change
feed into [events](https://pyvvo.github.io/funcd/docs/develop/services/events.md#react-to-a-row-change-in-a-sql-database) that call it.

## Call ctx.sql without a query builder

A handler can pass its own SQL to `ctx.sql`, as the TypeScript example sql-search does with SQLite's FTS5 full-text
search. Its Function declares the database by `name`, so funcd creates `search-db` and the Function owns it.

- `execute` runs a list of statements in one transaction, all or none, and a transaction never spans two calls. A
  statement is its text, or its text with parameters, such as `['DELETE FROM articles WHERE id = ?', [7]]`; named
  placeholders such as `:title` take an object, and a `RETURNING` clause's values come back in the result's `values`.
- `query` returns rows as objects keyed by column, and `queryValues` (`query_values` in Python) as lists; both only
  read. A parameter is a string, a number, a boolean or null.
- When the engine rejects a statement, the whole call fails, and the message names its position from 0, as in
  `statement 1: …`. A refused call throws in TypeScript and raises a `RuntimeError` in Python, with a message such as
  `context.sql.query failed: 400 …` or `context.sql.execute failed: …`. An uncaught error fails the call to the
  Function with 500.

### TypeScript

The Function, in `search.yaml`:

```yaml
# Function search: it declares search-db by name, so funcd creates it with search as its owner, and binds it as
# the alias app.
apiVersion: funcd.io/v1alpha1
kind: Function
metadata:
  name: search
  namespace: default
  resourceGroup: rg1
spec:
  runtime: nodejs22
  handler: handle
  image: oci-layout:///mnt/funcd-deps/registry:search
  sql:
    - name: search-db
  bindings:
    sql:
      - alias: app
        database: search-db
```

From the funcd-typescript repository, start the example:

```console
$ funcdctl dev examples/sql-search --gport 8080
```

In another terminal, create the tables, add an article, and search it:

```console
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"init"}' http://127.0.0.1:8080/function/search
{}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"add","title":"Raft in practice","body":"rqlite replicates SQLite with Raft","tags":["raft"]}' http://127.0.0.1:8080/function/search
{"id":1}
$ curl -s -X POST -H 'content-type: application/json' -d '{"op":"search","q":"raft"}' http://127.0.0.1:8080/function/search
{"hits":[{"id":1,"title":"Raft in practice","snippet":"rqlite replicates SQLite with [Raft]","tags":["raft"]}]}
```

Press Ctrl-C in the first terminal to stop.

The handler:

```ts
// The search function: plain context.sql, no ORM. Articles keep their tags as a JSON array, an FTS5
// index follows the table through triggers, and a search ranks matches with bm25 and returns a highlighted snippet.
import type { CloudEvent, FunctionContext, SQLStatement } from '@funcd-dev/shim';

const db = 'app';

// schema is idempotent, so init can run on every deploy. rqlite's SQLite has FTS5 and the JSON functions built in.
const schema: SQLStatement[] = [
  `CREATE TABLE IF NOT EXISTS articles (
     id INTEGER PRIMARY KEY,
     title TEXT NOT NULL,
     body TEXT NOT NULL,
     tags TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(tags)))`,
  `CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, body, content='articles', content_rowid='id')`,
  `CREATE TRIGGER IF NOT EXISTS articles_ai AFTER INSERT ON articles BEGIN
     INSERT INTO articles_fts(rowid, title, body) VALUES (new.id, new.title, new.body); END`,
  `CREATE TRIGGER IF NOT EXISTS articles_ad AFTER DELETE ON articles BEGIN
     INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body); END`,
  `CREATE TRIGGER IF NOT EXISTS articles_au AFTER UPDATE ON articles BEGIN
     INSERT INTO articles_fts(articles_fts, rowid, title, body) VALUES ('delete', old.id, old.title, old.body);
     INSERT INTO articles_fts(rowid, title, body) VALUES (new.id, new.title, new.body); END`,
];

export interface FuncInput {
  op: 'init' | 'add' | 'search' | 'tags' | 'remove';
  title?: string;
  body?: string;
  tags?: string[];
  q?: string;
  tag?: string;
  id?: number;
  limit?: number;
}

export interface Hit {
  id: number;
  title: string;
  snippet: string;
  tags: string[];
}

export interface FuncOutput {
  id?: number;
  hits?: Hit[];
  tags?: { tag: string; articles: number }[];
  changed?: number;
}

export async function handle(ctx: FunctionContext, event: CloudEvent<FuncInput>): Promise<FuncOutput> {
  const input = event.data ?? { op: 'search' };
  switch (input.op) {
    case 'init':
      await ctx.sql.execute(db, schema);
      return {};
    // Named parameters, and RETURNING gives the new row's id in the same call.
    case 'add': {
      const res = await ctx.sql.execute(
        db,
        'INSERT INTO articles (title, body, tags) VALUES (:title, :body, :tags) RETURNING id',
        { title: input.title ?? '', body: input.body ?? '', tags: JSON.stringify(input.tags ?? []) },
      );
      return { id: Number(res.values?.[0]?.[0]) };
    }
    case 'remove': {
      const res = await ctx.sql.execute(db, 'DELETE FROM articles WHERE id = ?', [input.id ?? 0]);
      return { changed: res.rowsAffected };
    }
    // json_each turns each article's tags into rows, so tags count like any column.
    case 'tags': {
      const rows = await ctx.sql.query(
        db,
        `SELECT t.value AS tag, count(*) AS articles FROM articles, json_each(articles.tags) AS t
         GROUP BY t.value ORDER BY articles DESC, tag`,
      );
      return { tags: rows.map((r) => ({ tag: String(r.tag), articles: Number(r.articles) })) };
    }
    default: {
      const rows = await ctx.sql.query(
        db,
        `SELECT a.id, a.title, snippet(articles_fts, 1, '[', ']', '…', 8) AS snippet, a.tags
         FROM articles_fts JOIN articles a ON a.id = articles_fts.rowid
         WHERE articles_fts MATCH :q
           AND (:tag IS NULL OR EXISTS (SELECT 1 FROM json_each(a.tags) WHERE value = :tag))
         ORDER BY bm25(articles_fts) LIMIT :limit`,
        { q: input.q ?? '', tag: input.tag ?? null, limit: input.limit ?? 10 },
      );
      return {
        hits: rows.map((r) => ({
          id: Number(r.id),
          title: String(r.title),
          snippet: String(r.snippet),
          tags: JSON.parse(String(r.tags)) as string[],
        })),
      };
    }
  }
}
```

## Access

- A Function reads the databases that it binds (`sql::read`) and writes those that it owns (`sql::write`) with no
  [role](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#choose-a-role). funcd checks reading for `query` and
  `queryValues`, and reading and writing for every `execute`, since `RETURNING` reads too.
- Any other write needs
  [`SQL Data Writer`](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security/spec.md#rolesassignmentspecassignmentsroleref), scoped to
  one `SQLDatabase` or the `Namespace`. `SQL Data Reader` adds nothing to a binding, and `Reader`, `Contributor` and
  `Owner` do not cover databases.
- A binding names only a database that its Function declares, and `ctx.sql` takes only a binding's alias, so no role
  reaches an unbound database.

The first example's TypeScript `grant.yaml`:

```yaml
apiVersion: funcd.io/v1alpha1
kind: RolesAssignment
metadata:
  name: notes-migrate-writes-notes-db
  namespace: default
  resourceGroup: rg1
spec:
  assignments:
    - principal:
        kind: Function
        name: notes-migrate
      roleRef:
        kind: BuiltinRole
        name: SQL Data Writer
      scope:
        kind: SQLDatabase
        name: notes-db
```

funcd applies these rules as a built-in policy in every namespace; an operator's
[Policy](https://pyvvo.github.io/funcd/docs/develop/security-and-networking/security.md#write-a-policy) cannot allow a write that it forbids:

```cedar title="Built-in SQL policy"
@id("sql-read-binding")
permit(principal, action == Action::"sql::read", resource)
  when { principal has sqlBindings && principal.sqlBindings.contains(resource) };

@id("sql-write-base")
permit(principal, action == Action::"sql::write", resource);

@id("sql-single-writer")
forbid(principal, action == Action::"sql::write", resource)
  unless { resource has writers && resource.writers.contains(principal) };
```

A denied call fails with 403 and names the rule, such as `cedar: forbidden by policy builtin/sql-single-writer`.

## Limits and quotas

- [`spec.quota`](https://pyvvo.github.io/funcd/docs/develop/services/sql/spec.md#sqldatabasespecquota) caps the database's size with `maxSize` or `maxBytes`. funcd measures
  after each `execute`, so a call can pass the cap; past it, only calls whose statements are each a single `DELETE` or
  `DROP` run.
- [`spec.resources`](https://pyvvo.github.io/funcd/docs/develop/services/sql/spec.md#sqldatabasespecresources) sets the engine's memory, 256 MiB by default, and CPU, on the
  containerd runtime only:

```yaml
apiVersion: funcd.io/v1alpha1
kind: SQLDatabase
metadata:
  name: notes-db
  namespace: default
  resourceGroup: rg1
spec:
  owner: notes
  quota:
    maxSize: 1Gi
  resources:
    memory: 512Mi
```

- One `ctx.sql` call sends at most 500 statements and 1 MiB, gets back at most 8 MiB, and runs at most
  [`sql.callTimeout`](https://pyvvo.github.io/funcd/docs/develop/running-funcd/spec.md#funcdconfigyaml), 30 seconds by default.
- A namespace holds at most `sql.maxDatabasesPerNamespace` databases, 20 by default.

## Data storage

On a server, each engine runs in a containerd container and keeps its SQLite files under
`<storage.dataDir>/providers/sqldatabase`, where they survive a restart; with `storage.mode: memory`, they are lost
when funcd stops. The process runtime starts no engine. A
[BackupSchedule](https://pyvvo.github.io/funcd/docs/develop/disaster-recovery/spec.md#backupschedulespecscope) that lists a database under
`scope.databases` copies it, and a Restore loads it back.

## Status

`funcdctl get sqldatabase notes-db -n default -o json` and `funcdctl get function notes -n default -o json` print the
status; with `funcdctl dev`, add the `--server` and `--token` flags of its banner. `status.bindings` counts the
Functions that bind the database.

| Phase or condition | Reason | Meaning |
| --- | --- | --- |
| SQLDatabase `Pending` | `EngineNotReady` | The engine is starting. |
| SQLDatabase `Pending` | `EngineConvergeFailed` | funcd could not start the engine, as on a server that runs the process runtime. funcd's log gives the cause. |
| SQLDatabase `Ready` | | The engine answers. |
| SQLDatabase `DataMissing` condition `True` | `NoDirectory` | On a server whose `storage.mode` is `file`, the default, a database that was `Ready` came back without its data folder: it starts empty and `Ready`, and keeps this condition until a Restore into it succeeds. No database shows it with `storage.mode: memory` or under `funcdctl dev`. |
| Function `Pending` | `SQLDatabaseNotFound` | A database that the Function binds does not exist. The Function starts once it exists. |
| Function `Deploying`, `Degraded` or `Ready` | `DependencyNotReady` | The engine of a database that the Function binds is not `Ready`, and each `ctx.sql` call fails. A Function that never served is `Deploying`. One that served is `Degraded` once no worker is ready, and stays `Ready`, with this reason on its `True` `Ready` condition, while some workers are. |
| Function `Pending` | `StoreNotOwned` | A database that the Function declares by `name` exists and is not the Function's, as [Changes and deletion](#changes-and-deletion) describes. |
| Any other reason | | The `Ready` condition's reason and message, read with the commands above, give the cause. |

## Changes and deletion

- A change of `spec.quota` keeps the engine. On a server, a change of `spec.resources` replaces it on the same data;
  until then the database is `Pending` and `ctx.sql` calls fail.
- funcd refuses to delete a database while a binding names it, while it holds a table, or while its engine cannot
  answer. Once deleted, its engine and data are gone.
- When a Function that declares the database by `name` is deleted, its entry's `deletion` decides: `retain`, the
  default, keeps the database, and `delete` deletes it, tables included. A new Function of the same name declares a
  kept database by `ref`, or waits with `StoreNotOwned`.

## CLI errors

`funcdctl dev` stops before it serves the example when it meets one of these local setup errors:

| Error | Action |
| --- | --- |
| `no node interpreter found for the node handler` | Put Node.js on the `PATH`, or set `FUNCD_NODE` to the path of `node`. |
| `no python interpreter found for the python handler` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. Under `uv run`, uv puts its environment's `python3` first. |
| `cannot load the runtime shim (needs Python ≥3.12; set FUNCD_PYTHON)` | Put Python 3.12 or later on the `PATH` as `python3`, or set `FUNCD_PYTHON` to its path. |
| `the folder holds a SQL database, but this funcdctl has no SQL engine` | Install the [dev build of funcdctl](https://pyvvo.github.io/funcd/docs/get-started/install.md), which includes the SQL engine, or build the engine as the message says. |

## Run it locally

- `funcdctl dev` runs each engine as a local process, without `spec.resources`.
- It deletes the data at stop. With [`--persist`](https://pyvvo.github.io/funcd/docs/develop/tools/funcdctl/spec.md#funcdctl-dev), it keeps it in
  `.funcd-dev/sql`; delete that folder to start the databases empty. `git status` lists the persist folder.
- Unlike for Buckets, it gives no role on databases, so a write that a platform refuses is refused locally too.

## Examples

- [sql-notes in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/sql-notes) and
  [sql-orders in Python](https://github.com/pyvvo/funcd-python/tree/main/examples/sql-orders): migrations, an owner
  that adds and lists rows, with Drizzle or SQLModel, and in Python a Function called on each change.
- [sql-search in TypeScript](https://github.com/pyvvo/funcd-typescript/tree/main/examples/sql-search): FTS5 search
  through `ctx.sql` with no query builder.
- [The todo App](https://github.com/pyvvo/funcd-functions/tree/main/apps/todo): a TypeScript owner and a Python reader
  of one database, with a backup, a restore and the change feed.
