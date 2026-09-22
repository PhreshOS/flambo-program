import { context, system } from "@phreshos/client"
import type { BrowserAPI } from "../core/application"
import type { BrowserRequests, BrowserServiceEvents } from "../../shared/service"

export function connect(): BrowserAPI {
  const service = system.service.prepare<BrowserServiceEvents>({
    program: "browser",
    process: "browser",
    endpoint: "server"
  })

  async function ready() {
    if (!await service.available()) {
      const program = await context.program()
      await program.findOrCreateProcess({ name: "browser", server: { service: true }, client: false })
    }
    await service.waitReady(30_000)
  }

  return {
    async request<Event extends keyof BrowserRequests>(event: Event, input: BrowserRequests[Event]["input"]) {
      await ready()
      return service.timeout(30_000).ask<BrowserRequests[Event]["output"]>(event, input)
    },
    subscribe(event, receive) {
      return service.subscribe(event, receive)
    }
  }
}
