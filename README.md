# Browser

A shared browser for people and agents on PhreshOS.

[PhreshOS](https://phreshos.com) ·
[Documentation](https://docs.phreshos.com) ·
[Source](https://github.com/PhreshOS/browser-program)

## Role

Browser provides authoritative Workspaces and Tabs that a person and an agent
can observe and control together. The Server owns browser execution and the
Client presents the same state through the PhreshOS Desktop.

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

`verify` checks the source, builds both Endpoints, and validates the packaged
Program shape.

`check` performs static checks, `build` creates distributable output, and `test`
runs Vitest assertions from `tests/`. Run `build` before testing built artifacts.
`verify` runs `check`, `build`, and `test` in order. Operational tooling belongs
in `scripts/`; tests and their fixtures belong in `tests/`. Verification uses
the committed dependency graph without local package substitutions.

## Architecture

One named Server Service owns the browser engine. Every Workspace has an
isolated Chromium context and exactly one distinct Client Process; ending
either lifetime ends the other. Every Tab is one page inside that context. A
Client reattaches to its Workspace when its document reloads, then renders an
acknowledged binary frame stream so slow displays cannot create an unbounded
queue. Agent operations and human input mutate the same authoritative state.

## Related repositories

- [`@phreshos/core`](https://github.com/PhreshOS/core) owns the Program and
  Endpoint contracts used here.
- [`@phreshos/client`](https://github.com/PhreshOS/client) and
  [`@phreshos/server`](https://github.com/PhreshOS/server) provide the two
  runtime boundaries used by the Program.
- [`@phreshos/react-ui`](https://github.com/PhreshOS/react-ui) provides the
  Browser interface components and Appearance integration.
- [PhreshOS System](https://github.com/PhreshOS/system) runs the resulting
  Program.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
