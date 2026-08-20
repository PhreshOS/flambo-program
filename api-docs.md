# Flambo browser service

Flambo's `browser` Server service owns isolated Chromium sessions. Every session is
private to the Process that created it and is shared by that Process's Endpoints. Consumers receive nothing until they
explicitly request a snapshot or start a live frame stream.

## Questions

- `session.create` — `{ viewport: { width, height } }` → `BrowserSnapshot`
- `session.list` — no payload → `BrowserWorkspace`
- `session.close` — `{ session }` → `undefined`
- `snapshot` — `{ session }` → `BrowserSnapshot`
- `navigate` — `{ session, url }` → `undefined`
- `back` — `{ session }` → `undefined`
- `forward` — `{ session }` → `undefined`
- `reload` — `{ session }` → `undefined`
- `stream.start` — `{ session, event }` → lease duration in milliseconds
- `stream.stop` — `{ session, event }` → `undefined`
- `metrics` — no payload → `BrowserMetrics`

Navigation questions return `undefined`; their visual result arrives through the
active frame stream. `BrowserSnapshot.image` and `BrowserFrame.image` contain a
base64 JPEG matching the returned viewport.

## Input publications

Publish `input` with one of these payloads. Input is ordered, fire-and-forget,
and never captures a screenshot:

- `{ action: "resize", session, viewport }`
- `{ action: "session.select", session }`
- `{ action: "pointer.click", session, x, y, button? }`
- `{ action: "wheel", session, deltaX, deltaY }`
- `{ action: "keyboard.type", session, text }`
- `{ action: "keyboard.press", session, key, modifiers? }`

To receive frames, subscribe to a private `frame:<uuid>` event before asking
`stream.start` to use that exact event. Frames are live values: they are neither
retained nor replayed. Publish `stream.keepalive` with `{ session, event }`
before the returned lease expires. Publish `stream.stop` with the same payload
when the representation no longer needs frames. Abandoned streams expire while
their Chromium sessions remain alive.

Session collections, ordering, and last selection belong to the Server and
survive Client representation replacement. Only `session.close`, owner Process
exit, or Flambo Server exit destroys a session. Navigation accepts absolute
HTTP and HTTPS URLs and `about:blank`.
