# Flambo

The PhreshOS web browser Program.

[Programs](https://docs.phreshos.com/runtime/programs) ·
[Services](https://docs.phreshos.com/runtime/services) ·
[Source](https://github.com/PhreshOS/flambo-program)

## Role

Flambo provides a persistent browser runtime whose state remains authoritative
outside any one Desktop representation. Its Server owns Chromium, isolated
Workspaces, and Sessions; its Client renders and interacts with that state.

The `browser` Server Service exposes the same browser capability to other
Programs. Flambo's internal design is documented in
[ARCHITECTURE.md](ARCHITECTURE.md), and its Program-facing operating contract is
documented in [agent.md](agent.md).

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

Build, run the production definition, or package a release with:

```sh
bun run build
bun run start
bun run pack
```

`verify` checks both Endpoints, exercises the browser and Service contracts,
and validates the production Program artifact.

## Related repositories

- [PhreshOS System](https://github.com/PhreshOS/system) owns Endpoint execution,
  Service routing, and the Desktop hosting Flambo.
- [`@phreshos/core`](https://github.com/PhreshOS/core) owns the shared Program,
  Endpoint, communication, and Service contracts.
- [`@phreshos/client`](https://github.com/PhreshOS/client) and
  [`@phreshos/server`](https://github.com/PhreshOS/server) provide Flambo's two
  runtime boundaries.
- [Lemo](https://github.com/PhreshOS/lemo-program) can consume the browser
  Service without defining Flambo's domain.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the repository workflow and
[SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Licensed under the [MIT License](LICENSE). Copyright © 2026 Zohayr SLILEH.
