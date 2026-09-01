import { defineConfig } from "@phreshos/core"

export default defineConfig({
  identity: "flambo",
  name: "Flambo",
  description: "The official PhreshOS web browser.",
  version: "0.1.27",
  icon: "icon.png",
  categories: ["Internet"],
  keywords: ["browser", "web", "workspace", "automation"],
  website: "https://github.com/PhreshOS/flambo-program",
  agent: "agent.md",
  buildCommand: "vite-node scripts/build.ts",
  server: {
    location: "dist/server",
    start: false,
    service: true,
    entryFile: "main.js",
    installCommand: "npm install --omit=dev && npx playwright install --with-deps chromium",
    uninstallCommand: "npx playwright uninstall",
    development: {
      startCommand: "vite-node source/server/main.ts"
    }
  },
  client: {
    location: "dist/client",
    title: "Flambo",
    size: { width: 1100, height: 720 },
    development: {
      url: "http://localhost:5270/",
      startCommand: "vite --config vite.client.ts"
    }
  }
})
