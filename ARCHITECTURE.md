# Flambo Architecture

This document is the canonical plan for rebuilding Flambo. Implementation
decisions must preserve these contracts unless the owner explicitly changes
them.

## Runtime shape

PhreshOS starts Flambo with only a Client endpoint by default. The Client
prepares the exact `flambo/server/browser` Service. If it is not enabled, the
Client finds or creates one separate server-only Process named
`browser-server`:

```ts
await program.process.create({
  name: "browser-server",
  server: true,
  client: false
})
```

Every concurrent Client converges on this uniquely named Process. Flambo must
never start the shared Server with `current.server.start()`: the Server must
not belong to a Client Process or end when that Client closes.

The Server owns one shared Chromium instance. Every Workspace owns one
isolated BrowserContext, and every Session in that Workspace owns one Page:

```text
Flambo Server Process
└── Chromium
    ├── Workspace → BrowserContext
    │   ├── Session → Page
    │   └── Session → Page
    └── Workspace → BrowserContext
        └── Session → Page
```

Sessions in one Workspace therefore share cookies, storage, authentication,
and other context state. Different Workspaces remain isolated.

## Workspace contract

A Workspace is created empty. Creating, attaching, or restoring a Workspace
must never create a Session implicitly. A Session exists only after an
explicit `session.create` request supplies its real viewport.

This is a fundamental invariant, not a loading optimization. Neither a
hardcoded initial viewport nor a default blank Page belongs to Workspace
creation.

A Workspace has one of two lifecycles:

- `client`: associated with exactly one Flambo Client Process;
- `explicit`: headless and independent of a Client.

The public Service may create either form:

```ts
workspace.create({ client: true })
workspace.create({ client: false })
```

Omitting `client` creates an explicit Workspace. Creating a client Workspace
starts a new client-only Flambo Process with the Workspace identity in an
immutable Process option. The operation succeeds only after that Client has
attached to the expected Workspace.

An ordinarily launched Flambo Client asks the Server to associate an empty
Workspace with its real Client Endpoint. A Client assigned an existing
Workspace through its Process option attaches to that reserved Workspace
instead of creating another.

### Bidirectional lifetime

Closing an associated Client closes its Workspace. Closing a client Workspace
closes its associated Client Process. Both roads are idempotent and converge
on one closing operation:

```text
Client exits ────────┐
                    ├── close Workspace, Pages and BrowserContext
Workspace closes ───┘                         │
                                             └── exit associated Client
```

The Server uses the retained `Process.exit()` capability for a client-only
Process. It does not call `client.stop()`, because the SDK rejects stopping a
Process's final live Endpoint.

An explicit Workspace has no Client to close and remains live until an
explicit `workspace.close` request.

## Authority and synchronization

Server Core is authoritative for Workspaces, Sessions, active selection,
page state, revisions, operation ordering, streams, and Chromium resources.
Client Core retains only the peer entities required by its interface.

Every Workspace snapshot is complete and immutable:

```ts
interface BrowserWorkspace {
  workspace: string
  lifecycle: "client" | "explicit"
  revision: number
  active: string | null
  sessions: readonly BrowserSession[]
}
```

Each accepted authoritative state change produces exactly one greater
Workspace revision. Server Core emits snapshots from retained state rather
than constructing competing asynchronous snapshots. Client Core applies only
snapshots newer than the latest revision it has retained.

Workspace updates and Session frames use explicitly registered, leased event
streams. Frame sequences are monotonic per Session. A slow representation
retains only the latest pending frame rather than growing an unbounded queue.

All operations affecting one Page enter that Session's serialized operation
queue. Human interaction and Agent service requests therefore operate on the
same state without racing around authority.

## Client startup and viewport

Client Core performs one single-flight Service connection:

1. prepare the exact browser Service handle;
2. use it immediately when enabled;
3. otherwise find or atomically create `browser-server`;
4. wait for the Service to become ready;
5. request or attach the Client's Workspace;
6. retain its projected Workspace entity and live synchronization.

Client View renders the browser shell before the first Session exists. It
measures the real page Surface and passes that viewport to Client Core. Only
then may the person explicitly create a Session. The first Page and frame are
therefore born at the correct dimensions.

Later resizes are requested only when the rounded measured dimensions differ
from the authoritative Session viewport. React callbacks and observers remain
stable across unrelated renders.

## Service behavior

The Server Service exposes Server Core; it does not own browser state.
Questions that need success, failure, or a result use `ask`, including:

- Workspace and Session creation or closure;
- selection and navigation;
- resize and discrete input;
- snapshots and state reads.

Disposable stream lease maintenance may use fire-and-forget publications.
Client Core may coalesce high-frequency wheel or text input before submitting
the resulting ordered operation.

Every request is validated once at Server View before entering Core. The
contract uses one organized Zod schema rather than duplicated manual checks.
Workspace and Session identities, viewports, coordinates, URLs, text, and
stream event names remain bounded.

The source Endpoint supplied by the PhreshOS Service boundary is
authoritative. A payload cannot claim to be a Client. Client association is
accepted only when that source is the real expected Client Endpoint.

## MVC placement

MVC means Main, View, Core and is preserved independently on both sides:

```text
Client View → Client Core ⇄ Server View → Server Core
```

- Main only starts View.
- View constructs and represents Core.
- Server Core owns browser entities, state, behavior, and resources.
- Server View adapts the PhreshOS Service and lifecycle SDKs to Server Core.
- Client Core owns communication and retained peer entities.
- Client View renders Client Core and knows no Service key, transport event,
  Process discovery rule, or authoritative Server implementation.

`main`, `view`, and `core` remain the only architectural peers beneath each
Client or Server source root. Chromium is an application resource provider
inside Server Core, not a fourth peer or a general library.

## Reliability requirements

- Concurrent startup creates at most one shared Server Process.
- Client creation rolls back its reserved Workspace if attachment fails.
- Closing is idempotent across simultaneous Client and Workspace termination.
- A closing Workspace rejects new operations and safely settles or cancels
  work already in flight.
- BrowserContext, Page, stream, timer, subscription, and Process handles are
  released by their actual owner.
- Browser, Context, Page, Client, and Service failure become authoritative
  state transitions; dead resources never remain registered as live entities.
- No compatibility layer preserves the prototype's incorrect ownership or
  implicit Session behavior.

## Verification

Focused tests must cover singleton Server startup, the Client attachment
handshake, bidirectional lifetime, empty Workspace creation, context sharing,
cross-Workspace isolation, revision ordering, operation serialization, stream
backpressure, viewport correctness, and failure cleanup. Run Flambo's
typecheck, focused tests, production build, and a real System integration test.
The full ecosystem audit is reserved for an actual cross-cutting contract or
release.
