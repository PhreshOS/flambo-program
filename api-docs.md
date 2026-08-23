# Flambo browser service

Flambo runs one authoritative browser Server. Consumers work through explicit,
isolated workspaces hosted by that Server. A workspace identity is required for
every session, navigation, input, snapshot, and frame-stream operation.

Flambo Processes start Client-only. When the Service is absent, the first Client
atomically creates a separate, server-only Process named `browser-server`.
Concurrent Clients converge on that uniquely named Process and every Client
connects to its Service. The Server is not owned by any Client Process, so
closing a Client cannot terminate the shared Service or another Workspace.
It closes only the Workspace associated with that Client.

The Server owns one Chromium process. Each workspace owns one isolated browser
context, and every session in that workspace owns one page. Sessions in the
same workspace share cookies and storage; different workspaces do not.

## Workspace lifecycle

- `workspace.create` — `{ client?: boolean }` → `BrowserWorkspace`
- `workspace.read` — `{ workspace }` → `BrowserWorkspace`
- `workspace.close` — `{ workspace }` → `null`

With `client: true`, Flambo creates a new Client-only Process, opens its Window,
and assigns the workspace to it. The workspace closes when that Client stops or
its Process exits, and closing the workspace closes its associated Client
Process. Any Server or Client Service consumer may request this form. The
created Client attaches to the supplied workspace internally; it does not
create a second workspace.

With `client: false`, or when `client` is omitted, Flambo creates a headless
`explicit` workspace independent of the requesting Process. It remains
available through its workspace identity until a consumer calls
`workspace.close`. The consumer that finishes the work is responsible for
closing it.

Every new workspace is empty. Creating, attaching, or restoring a workspace
never creates a session. Only an explicit `session.create` question creates a
page, and that question must provide the real viewport.

`BrowserWorkspace` contains `{ workspace, lifecycle, revision, active, sessions }`. A
workspace identity may be handed to another consumer when both should operate
on the same browser state. Workspaces are isolated unless this identity is
shared deliberately.

Subscribe to `workspace.change` to receive the latest revisioned
`BrowserWorkspace` snapshot whenever its sessions, active selection, or page
state changes. Consumers should ignore revisions older than the newest snapshot
they have already applied.

## Session questions

- `session.create` — `{ workspace, viewport: { width, height } }` → `BrowserSnapshot`
- `session.close` — `{ workspace, session }` → `null`
- `snapshot` — `{ workspace, session }` → `BrowserSnapshot`
- `navigate` — `{ workspace, session, url }` → `null`
- `back` — `{ workspace, session }` → `null`
- `forward` — `{ workspace, session }` → `null`
- `reload` — `{ workspace, session }` → `null`
- `stream.start` — `{ workspace, session, event }` → lease duration in milliseconds
- `stream.stop` — `{ workspace, session, event }` → `null`
- `metrics` — no payload → `BrowserMetrics`

Navigation questions return `null`; their visual result arrives through the
active frame stream. `BrowserSnapshot.image` and `BrowserFrame.image` contain a
base64 JPEG matching the returned viewport.

## Input questions

Ask `input` with one of these payloads. Input is ordered and never captures a
screenshot. The answer is `null` after the operation completes:

- `{ action: "resize", workspace, session, viewport }`
- `{ action: "session.select", workspace, session }`
- `{ action: "pointer.click", workspace, session, x, y, button? }`
- `{ action: "wheel", workspace, session, deltaX, deltaY }`
- `{ action: "keyboard.type", workspace, session, text }`
- `{ action: "keyboard.press", workspace, session, key, modifiers? }`

To receive frames, subscribe to a private `frame:<uuid>` event before asking
`stream.start` to use that exact event. Frames are live values: they are neither
retained nor replayed. Publish `stream.keepalive` with `{ workspace, session,
event }` before the returned lease expires. Publish `stream.stop` with the same
payload when the representation no longer needs frames. Abandoned streams
expire while their Chromium sessions remain alive.

Session collections, ordering, and active selection belong to their workspace
in Flambo Core and survive Client representation replacement. Navigation
accepts absolute HTTP and HTTPS URLs and `about:blank`.
