# Contributing

Flambo is the official PhreshOS browser Program. Its Server owns browsing
sessions and its Client represents them on the desktop.

## Development

Install the pinned toolchain and verify the repository:

```sh
bun install --frozen-lockfile
bun run verify
```

The repository must remain independently installable, buildable, packageable,
and runnable without the PhreshOS workspace around it. Changes to the public
browser service must update `api-docs.md` and its lifecycle verification.

## Pull requests

Explain which browser behavior the change serves, include focused proof, and
keep each pull request limited to one coherent responsibility.
