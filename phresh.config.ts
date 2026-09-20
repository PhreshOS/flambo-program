import { defineConfig } from "@phreshos/core"

export default defineConfig({
  identity: "flambo",
  name: "Flambo",
  description: "The official PhreshOS web browser.",
  version: "0.1.46",
  icon: "icon.png",
  categories: ["Internet"],
  keywords: ["browser", "web", "workspace", "automation"],
  website: "https://github.com/PhreshOS/flambo-program",
  agent: "agent.md",
  permissions: { services: ["browser-server"] },
  buildCommand: "vite-node scripts/build.ts",
  server: {
    location: "dist/server",
    start: false,
    service: true,
    worker: "main.js",
    installCommand: "npm install --omit=dev --no-audit && npx playwright install --with-deps chromium",
    uninstallCommand: "npx playwright uninstall",
    devCommand: "vite-node source/server/main.ts"
  },
  client: {
    location: "dist/client",
    title: "Flambo",
    size: { width: 1100, height: 720 },
    devCommand: "vite --config vite.client.ts"
  }
})
