import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"
import { resolve } from "node:path"

export default defineConfig({
    root: "client",
    plugins: [react()],
    base: process.env.PHRESHOS_CLIENT_BASE ?? "./",
    resolve: {
        tsconfigPaths: true
    },
    server: {
        port: Number(process.env.PHRESHOS_CLIENT_PORT ?? "5200"),
        strictPort: true
    },
    build: {
        emptyOutDir: true,
        outDir: resolve(import.meta.dirname, "dist/client")
    }
})
