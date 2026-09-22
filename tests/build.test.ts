import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import config from "../phresh.config"
import manifest from "../package.json" with { type: "json" }
import { test } from "vitest"

test("build contract", async () => {
  assert.equal(config.identity, "browser")
  assert.equal(config.name, "Browser")
  assert.equal(config.version, manifest.version)
  assert.equal(config.server?.location, "dist/server")
  assert.equal(config.server?.worker, "main.js")
  assert.equal(config.server?.devCommand, "vite-node server/main.ts")
  assert.equal(config.server?.service, true)
  assert.match(config.server?.installCommand ?? "", /playwright install chromium/)
  assert.equal(config.client?.location, "dist/client")
  assert.deepEqual(config.client?.size, { width: 1100, height: 720 })

  assert(readFileSync("dist/client/index.html", "utf8").length > 0)
  assert(readFileSync("dist/server/main.js", "utf8").length > 0)
}, 120_000)
