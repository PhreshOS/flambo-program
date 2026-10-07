# Flambo

Flambo is a browser on this machine. One Chromium runs in Flambo's Server;
windows show its pages as live video and send input back. A tab belongs to the
window that opened it, and closes when that window closes. A person and an
agent working on the same tab see and change the same page.

Every tab lives in one Server: the Process named `flambo`, Server only, which
is also the `flambo` Service. Flambo windows are Client-only Processes that
reach it.

Reach it with:

```sh
phresh endpoint ask --program flambo --process flambo --endpoint server --event tabs.list --json
```

When the Process is not running, find or create it with the Server enabled and
the Client disabled. Never start another Server, and never give a window
Process a Server.

## Open a page

`tab.open` `{ address?, position? }` opens a new Flambo window whose first tab
goes to `address`, and returns `{ window }`. `position` is `{ x, y }` on the
Desktop's plane; without it the System places the window. Prefer a window the
owner can see, so they see what you do.

`address` is what a person would type in the address bar: an address with or
without its scheme, or words, which are searched for.

## Work in a tab

1. `tabs.list` returns every tab: `{ tab, title, url, favicon, loading,
   canGoBack, canGoForward, window }`. `window` is the identity of the window
   Process the tab belongs to. A new tab, still blank, has `url` `""`.
2. Read the page with `tab.text` `{ tab }`: the page as a tree of what it offers
   people (headings, text, links, buttons, fields), in YAML.
3. See it with `tab.picture` `{ tab }`: a JPEG of the page as it is.
4. Act on it:

| Event | Payload | Does |
| --- | --- | --- |
| `tab.navigate` | `{ tab, address }` | Goes to an address, or searches for words |
| `tab.search` | `{ tab, text }` | Searches for the words, whatever they look like |
| `tab.back` / `tab.forward` / `tab.reload` | `{ tab }` | Moves in the tab's history |
| `tab.pointer` | `{ tab, input }` | Moves, presses, releases, or turns the wheel |
| `tab.insert` | `{ tab, text }` | Types text into what has focus |
| `tab.press` | `{ tab, keys }` | Presses a key or a combination |
| `tab.create` | `{ window, address? }` | Opens another tab in a window |
| `tab.close` | `{ tab }` | Closes the tab |

`input` for `tab.pointer` is one of `{ type: "move", x, y }`, `{ type: "down" |
"up", x, y, button, clickCount }`, or `{ type: "wheel", x, y, deltaX, deltaY }`.
Points are CSS pixels from the page's top left corner; `button` is `left`,
`middle`, or `right`. A click is a `down` then an `up` at the same point.

`keys` names keys as the DOM does, joined with `+`, such as `Enter`, `Tab`, or
`ControlOrMeta+A`. `ControlOrMeta` is the key that holds shortcuts on the
machine Flambo runs on.

## Publications

- `tabs.changed`: the whole list, whenever a tab opens, closes, or changes its
  address, title, icon, or loading state.

`sites.list`, `tab.resize`, `tab.scheme`, `tab.key`, `tab.watch`,
`tab.unwatch`, `tab.acknowledge`, and the `video.<tab>` publications belong to
Flambo windows.

Tabs live in the Server's memory: when it ends, every tab closes. What a person
signs into stays, in Flambo's own browser profile.
