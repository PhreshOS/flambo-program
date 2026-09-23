import { context, system } from "@phreshos/client"
import type { FlamboAPI } from "../core/application"
import type { FlamboRequests, FlamboServiceEvents } from "../../shared/service"

export function connect(): FlamboAPI {
  const service = system.service.prepare<FlamboServiceEvents>({
    program: "flambo",
    process: "flambo",
    endpoint: "server"
  })

  async function ready() {
    if (!await service.available()) {
      const program = await context.program()
      await program.findOrCreateProcess({ name: "flambo", server: { service: true }, client: false })
    }
    await service.waitReady(30_000)
  }

  return {
    async request<Event extends keyof FlamboRequests>(event: Event, input: FlamboRequests[Event]["input"]) {
      await ready()
      return service.timeout(30_000).ask<FlamboRequests[Event]["output"]>(event, input)
    },
    subscribe(event, receive) {
      return service.subscribe(event, receive)
    }
  }
}
