import { externalDependencies } from "@/vite.config"
import packageConfig from "@/package.json"
import { cp, rm, writeFile } from "node:fs/promises"

process.env.NODE_ENV = "production"

const { build } = await import("vite")

await rm("dist", { recursive: true, force: true })

const dependencies: Partial<typeof packageConfig.dependencies> = {}

for (const dependency of externalDependencies) dependencies[dependency] = packageConfig.dependencies[dependency]

await build({ configFile: "vite.config.ts", ssr: { noExternal: true } })
await build({ configFile: "vite.client.ts" })
await writeFile("dist/server/package.json", JSON.stringify({ type: "module", dependencies }))
// Chromium loads the capture extension from beside the Server, as files, not as part of its bundle.
await cp("source/server/core/capture/extension", "dist/server/extension", { recursive: true })
// The install command runs beside the Server too.
await cp("source/server/install-browser.mjs", "dist/server/install-browser.mjs")
