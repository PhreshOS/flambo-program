import { externalDependencies } from "@/vite.config"
import { rm, writeFile } from "node:fs/promises"
import packageConfig from "@/package.json"
import { build } from "vite"

await rm("dist", { recursive: true, force: true })

const dependencies: Partial<typeof packageConfig.dependencies> = {}

for (const dependency of externalDependencies) dependencies[dependency] = packageConfig.dependencies[dependency]

await build({ configFile: "vite.config.ts", ssr: { noExternal: true } })
await build({ configFile: "vite.client.ts" })
await writeFile("dist/server/package.json", JSON.stringify({ type: "module", dependencies }))
