import { defineConfig } from "@phreshos/core"

export default defineConfig({
    identity: "flambo",
    name: "Flambo",
    description: "A browser on the machine, shown as a live picture, for people and agents.",
    version: "0.5.0",
    // Drawn from icon.svg: a flame of leaves, green at its heart and apricot at its tips.
    icon: "icon.png",
    categories: ["Internet"],
    keywords: ["browser", "web", "tabs"],
    website: "https://github.com/PhreshOS/flambo-program",
    agent: "agent.md",
    buildCommand: "vite-node scripts/build.ts",
    // One Server holds the browser and every tab, in the Process named "flambo", which is the "flambo"
    // Service. Windows are Clients that show their own tabs.
    server: {
        location: "dist/server",
        start: false,
        service: true,
        worker: "main.js",
        // Chromium comes with Flambo; on Linux its native libraries too, wherever they can be installed
        // without a password (see install-browser.mjs).
        installCommand: "npm install --omit=dev --no-audit && node install-browser.mjs",
        devCommand: "vite-node source/server/main.ts"
    },
    client: {
        location: "dist/client",
        title: "Flambo",
        // Flambo draws its own header: the tabs sit in the title row, beside the window buttons.
        header: false,
        // A browser shows pages made for wide screens, so it asks for room to show them.
        size: { width: 1100, height: 700 },
        devCommand: "vite --config vite.client.ts"
    }
})
