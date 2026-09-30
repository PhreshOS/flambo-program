import { defineConfig } from "@phreshos/core"

export default defineConfig({
    identity: "flambo",
    name: "Flambo",
    description: "A shared browser for people and agents.",
    version: "0.1.62",
    // Drawn from icon.svg: a flame of leaves, green at its heart and apricot at its tips.
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
        // Chromium is unusable on a clean Linux host unless its native libraries are installed with it.
        installCommand: "npm install --omit=dev --no-audit && npx playwright install --with-deps chromium",
        devCommand: "vite-node server/main.ts"
    },
    client: {
        location: "dist/client",
        title: "Flambo",
        // A browser shows pages made for wide screens, so it asks for room to show them.
        size: { width: 1100, height: 700 },
        header: false,
        devCommand: "vite --config vite.client.ts"
    }
})
