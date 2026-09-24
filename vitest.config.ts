import { defineConfig } from "vitest/config"

export default defineConfig({
  resolve: { dedupe: ["react", "react-dom"] },
  test: {
    pool: "forks",
    maxWorkers: 2,
    projects: [
      {
        extends: true,
        test: {
          name: "default",
          include: [
            "tests/**/*.test.{ts,tsx,mjs}"
          ],
          exclude: [
            "tests/**/*.platform.test.*",
            "tests/**/*.live.test.*"
          ],
          environment: "node",
          testTimeout: 30000
        }
      }
      ,
      {
        extends: true,
        test: {
          name: "platform",
          include: ["tests/**/*.platform.test.ts"],
          environment: "node",
          testTimeout: 60_000
        }
      }
    ]
  }
})
