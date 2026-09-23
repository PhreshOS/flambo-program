import { defineConfig } from "@phreshos/core"

export default defineConfig({
    identity: "flambo",
    name: "Flambo",
    description: "A shared browser for people and agents.",
    version: "0.1.51",
    icon: "icon.png",
    categories: ["Internet"],
    keywords: ["browser", "web", "tabs", "workspace"],
    website: "https://github.com/PhreshOS/flambo-program",
    agent: "agent.md",
    buildCommand: "vite-node scripts/build.ts",
    permissions: { services: ["flambo"] },
    server: {
        location: "dist/server",
        worker: "main.js",
        start: false,
        service: true,
        installCommand: "npm install --omit=dev --no-audit && npx playwright install chromium",
        devCommand: "vite-node server/main.ts"
    },
    client: {
        location: "dist/client",
        title: "Flambo",
        header: false,
        size: { width: 1100, height: 720 },
        devCommand: "vite --config vite.client.ts"
    }
})
