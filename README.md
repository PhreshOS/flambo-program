# Flambo

The official PhreshOS web browser Program.

Flambo provides a persistent browser runtime whose state remains authoritative
outside any one desktop representation.

## Model

The Server owns one Chromium process, isolated Workspaces, and the Sessions
inside them. The Client renders and interacts with that state. Reloading or
replacing a Client does not replace the browser authority.

Flambo also exposes its browser capability through the `browser` Server
Service. Other Programs can create and operate Sessions through the same
backend used by the Flambo interface.

## Installation

```sh
phresh install flambo --run
```

## Development

```sh
bun install --frozen-lockfile
bun run verify
bun run dev
```

Build, attach the production definition, or package a release with:

```sh
bun run build
bun run start
bun run pack
```

`verify` checks both Endpoints, exercises the browser and Service contracts,
and validates the production Program artifact.

## Repository boundary

This repository owns Flambo's browser domain, Chromium lifecycle, browser
Service, and Client representation. Its architecture is documented in
[ARCHITECTURE.md](ARCHITECTURE.md), and its Program-facing operating contract is
documented in [agent.md](agent.md).

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
