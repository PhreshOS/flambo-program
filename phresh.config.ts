import { defineConfig } from "@phreshos/core"

export default defineConfig({
  identity: "flambo",
  name: "Flambo",
  description: "The official PhreshOS web browser.",
  version: "0.1.4",
  icon: "flambo-icon.png",
  buildCommand: "vite-node --config vite.server.ts source/build.ts",
  server: {
    location: "dist/server",
    startCommand: "node main.js",
    installCommand: "npm install --omit=dev && npx playwright install --with-deps chromium",
    development: {
      startCommand: "vite-node --watch --config vite.server.ts source/server/main.ts"
    }
  },
  client: {
    location: "dist/client",
    title: "Flambo",
    size: { width: 1100, height: 720 },
    development: {
      url: "http://localhost:5270/",
      startCommand: "vite dev --config vite.client.ts"
    }
  }
})
