# Flambo

A browser on the machine, shown as a live picture, for people and agents.

[Programs](https://phreshos.com/docs/program/programs) ·
[Communication](https://phreshos.com/docs/program/communication) ·
[Source](https://github.com/PhreshOS/flambo-program)

## Role

Flambo runs one Chromium in its Server, the `flambo` Service, and shows its
pages in Flambo windows as live video. A tab belongs to the window that opened
it and closes with it; a link that opens a new tab opens it in the same window.
People and agents act on the same pages, and what a person signs into stays in
Flambo's own browser profile.

A new tab is blank in Chromium and drawn by the window itself: a greeting, a
search field, and the sites visited most. Nothing is captured until the tab goes
to a page.

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run dev
```

Build, run the production definition, or package the Program with:

```sh
bun run build
bun run start
bun run pack
```

`check` performs static checks, `build` creates distributable output, and `test`
runs Vitest assertions from `tests/`. Run `build` before testing built artifacts.
`verify` runs `check`, `build`, and `test` in order. Operational tooling belongs
in `scripts/`; tests and their fixtures belong in `tests/`. Verification uses
the committed dependency graph without local package substitutions.

## Architecture

Chromium loads a small extension that Flambo ships. Over a local socket only the
Server knows, it names the tab behind each page, reports each tab's address,
title, icon, and loading state, reads the sites visited most, and captures a
tab as video while a window shows it.

A watched tab is captured at its page's size in device pixels, so text is drawn
sharp, and encoded as VP9 with WebCodecs: lighter while the page moves, and its
last picture sent again in full detail once the page stands still. The window
decodes the pieces onto a canvas and says how far it has shown them; a window
that falls behind skips to a fresh key piece, so it shows the present, late,
rather than the past, in order. A page that changes size is captured anew at
its new size.

Pointer, wheel, and keys go back to the page in the order they happened; moves
and wheel turns that pile up while one is on its way are merged. Text pasted
into a window is typed into the page.

## Related repositories

- [`@phreshos/core`](https://github.com/PhreshOS/core) owns the Program and
  Endpoint contracts used here.
- [`@phreshos/client`](https://github.com/PhreshOS/client) and
  [`@phreshos/server`](https://github.com/PhreshOS/server) provide the two
  runtime boundaries used by the Program.
- [`@phreshos/react-ui`](https://github.com/PhreshOS/react-ui) provides the
  Flambo interface components and Appearance integration.
- [PhreshOS System](https://github.com/PhreshOS/system) runs the resulting
  Program.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
