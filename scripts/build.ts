import packageConfig from "../package.json" with { type: "json" }
import { externalDependencies } from "../vite.config"
import { rm, writeFile } from "node:fs/promises"

process.env.NODE_ENV = "production"

const { build } = await import("vite")

const dependencies: Partial<typeof packageConfig.dependencies> = {}

await rm("dist", { recursive: true, force: true })

for (const dependency of externalDependencies) dependencies[dependency] = packageConfig.dependencies[dependency]

await build({ configFile: "vite.config.ts", ssr: { noExternal: true } })
await build({ configFile: "vite.client.ts" })
await writeFile("dist/server/package.json", JSON.stringify({ type: "module", dependencies }))
