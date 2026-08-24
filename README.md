# Flambo

Flambo is the official PhreshOS web browser Program.

Its Server owns one Chromium process, an isolated browser context for each
Workspace, and the Sessions inside those Workspaces. Its Client is a desktop
representation that sends interaction and renders the resulting frames.
Refreshing or replacing a Client does not make that representation the owner
of browser state.

Flambo also exposes its browser capability as the documented `browser` Server
service, allowing other Programs to create and operate sessions through the
same authoritative backend.

## Install

Install the verified official release through the Phresh CLI:

```sh
phresh install flambo --run
```

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run dev
```

`verify` type-checks and builds both Endpoints, exercises the session lifecycle,
and validates the production artifact against the Program declaration.

The accepted rebuild and ownership model are recorded in
[ARCHITECTURE.md](ARCHITECTURE.md). Program-specific operating knowledge for
agents is documented in [agent.md](agent.md).

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
