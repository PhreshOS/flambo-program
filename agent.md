# Flambo

Flambo provides shared, server-owned web Workspaces. A Workspace owns an
isolated browser context and an ordered collection of Tabs. People and agents
that address the same Workspace operate on the same authoritative Tabs.

## Service

Flambo's authority is the named Server Service at:

```json
{ "program": "flambo", "process": "flambo", "endpoint": "server" }
```

Find or create that Process with the Server enabled as a Service and the Client
disabled. Flambo Clients use the same Service rather than starting a separate
authority.

Every Workspace owns one distinct Client Process. `workspace.create` creates
both, so an agent does not create or assign the Client separately. Ending the
Workspace ends that Client Process, and ending the Client Process closes the
Workspace. Reloading the Client document preserves both lifetimes.

## Workspaces

| Event | Payload | Result |
| --- | --- | --- |
| `workspace.list` | none | `WorkspaceSnapshot[]` |
| `workspace.create` | none | created `WorkspaceSnapshot`; opens its Client |
| `workspace.read` | `{ workspace }` | current `WorkspaceSnapshot` |
| `workspace.close` | `{ workspace }` | `null` |

A `WorkspaceSnapshot` contains `{ id, revision, activeTab, tabs }`.
`workspace.changed` publishes each new authoritative snapshot, and
`workspace.closed` publishes `{ workspace }` after closure. Subscribe before
the initial read, retain the highest revision, and ignore older snapshots.

## Tabs

| Event | Payload | Result |
| --- | --- | --- |
| `tab.create` | `{ workspace, viewport: { width, height } }` | created `TabSnapshot` |
| `tab.close` | `{ workspace, tab }` | `null` |
| `tab.select` | `{ workspace, tab }` | `null` |
| `tab.navigate` | `{ workspace, tab, url }` | current `TabSnapshot` |
| `tab.back` | `{ workspace, tab }` | current `TabSnapshot` |
| `tab.forward` | `{ workspace, tab }` | current `TabSnapshot` |
| `tab.reload` | `{ workspace, tab }` | current `TabSnapshot` |
| `tab.resize` | `{ workspace, tab, viewport }` | current `TabSnapshot` |
| `tab.capture` | `{ workspace, tab }` | current JPEG `TabFrame` |

`TabSnapshot` contains `{ id, url, title, canGoBack, canGoForward, viewport }`. `TabFrame` contains
`{ tab, viewport, mimeType, data }`; `data` is binary JPEG data. Use complete
Workspace and Tab identities returned by the Service rather than abbreviations.

## Input

| Event | Payload | Result |
| --- | --- | --- |
| `tab.movePointer` | `{ workspace, tab, x, y }` | current `TabSnapshot` |
| `tab.click` | `{ workspace, tab, x, y, button }` | current `TabSnapshot` |
| `tab.wheel` | `{ workspace, tab, deltaX, deltaY }` | current `TabSnapshot` |
| `tab.type` | `{ workspace, tab, text }` | current `TabSnapshot` |
| `tab.press` | `{ workspace, tab, key, modifiers }` | current `TabSnapshot` |

Pointer coordinates refer to the Tab viewport. `button` is `left`, `middle`, or
`right`. Modifiers are any of `Alt`, `Control`, `Meta`, and `Shift`.

The Flambo Client uses acknowledged live frames internally. Agents that do not
present a Client interface should use `tab.capture` when they need to inspect a
Tab visually.
