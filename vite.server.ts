import packageConfig from "./package.json" with { type: "json" }
import { defineConfig } from "vite"
import { resolve } from "node:path"

export const externalDependencies: (keyof typeof packageConfig.dependencies)[] = ["playwright"]

export default defineConfig({
  root: "source/server",
  resolve: {
    tsconfigPaths: true
  },
  ssr: {
    external: externalDependencies
  },
  build: {
    ssr: true,
    emptyOutDir: true,
    outDir: resolve(import.meta.dirname, "dist/server"),
    rolldownOptions: {
      input: "main.ts"
    }
  }
})
