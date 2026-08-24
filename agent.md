# Flambo

Flambo provides browser workspaces for people and agents. One authoritative
browser Server owns all browser state, while visible Client Processes represent
individual workspaces.

## Operating mode

The authoritative browser belongs to one shared Process named
`browser-server`. That Process runs only Flambo's Server Endpoint. Reuse the
named Process when it exists; when absent, create it with the Server enabled and
the Client disabled.

Ordinary visible Flambo Processes are Client-only. The shared Server is not
owned by any Client Process, so closing one Window cannot terminate the browser
authority or another workspace.

The Server owns one Chromium process. Each workspace owns one isolated browser
context, and every session in that workspace owns one page. Sessions in the
same workspace share cookies and storage; different workspaces do not.

## Workspace lifecycle

The Server Endpoint accepts these request-response events:

- `workspace.create` — `{ client?: boolean }` → `BrowserWorkspace`
- `workspace.attach` — `{ workspace, client }` → `BrowserWorkspace`
- `workspace.read` — `{ workspace }` → `BrowserWorkspace`
- `workspace.close` — `{ workspace }` → `null`

With `client: true`, Flambo creates a Client-only Process, opens its Window, and
assigns the workspace to it. The workspace closes when that Client stops or its
Process exits, and closing the workspace closes its associated Client Process.
The created Client attaches to the supplied workspace internally; it does not
create a second workspace.

With `client: false`, or when `client` is omitted, Flambo creates an explicit
workspace independent of any Client. It remains available through its identity
until `workspace.close`. The operation that finishes using it is responsible
for closing it.

Every new workspace is empty. Creating, attaching, or restoring a workspace
never creates a session. Only `session.create` creates a page, and it requires
the real viewport.

`BrowserWorkspace` contains `{ workspace, lifecycle, revision, active,
sessions }`. A workspace identity may be shared deliberately when multiple
operators should work on the same browser state. Workspaces remain isolated
otherwise.

The Server Endpoint emits `workspace.change` with the latest revisioned
`BrowserWorkspace` whenever sessions, active selection, or page state changes.
Ignore revisions older than the newest snapshot already applied.

## Sessions

The Server Endpoint accepts:

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

Navigation returns `null`; its visual result arrives through the active frame
stream or a later `snapshot`. `BrowserSnapshot.image` and `BrowserFrame.image`
contain a base64 JPEG matching the returned viewport.

Navigation accepts absolute HTTP and HTTPS URLs and `about:blank`.

## Input

The `input` event accepts one of these payloads and returns `null` after the
ordered operation completes. Input never captures a screenshot.

- `{ action: "resize", workspace, session, viewport }`
- `{ action: "session.select", workspace, session }`
- `{ action: "pointer.click", workspace, session, x, y, button? }`
- `{ action: "wheel", workspace, session, deltaX, deltaY }`
- `{ action: "keyboard.type", workspace, session, text }`
- `{ action: "keyboard.press", workspace, session, key, modifiers? }`

## Frame streams

`stream.start` uses the supplied private event name for live `BrowserFrame`
values. Frames are neither retained nor replayed.

The Server Endpoint accepts `stream.keepalive` and `stream.stop` publications
with `{ workspace, session, event }`. Send `stream.keepalive` before the returned
lease expires and `stream.stop` when frames are no longer needed. Abandoned
streams expire while their Chromium sessions remain alive.

Session collections, ordering, and active selection belong to Flambo Core and
survive Client representation replacement.
