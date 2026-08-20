import { host } from "@phreshos/client"
import type {
  BrowserFrame,
  BrowserInputRequest,
  BrowserKeyRequest,
  BrowserMetrics,
  BrowserPointerRequest,
  BrowserSnapshot,
  BrowserViewport,
  BrowserWheelRequest,
  BrowserWorkspace
} from "@server/core/browser"

export const browserService = host.service({
  program: "flambo",
  endpoint: "server",
  name: "browser"
})

const channel = browserService.channel.timeout(35_000)
const live = browserService.channel

export const browser = {
  create(viewport: BrowserViewport) {
    return channel.ask<BrowserSnapshot>("session.create", { viewport })
  },
  workspace() {
    return channel.ask<BrowserWorkspace>("session.list")
  },
  close(session: string) {
    return channel.ask("session.close", { session })
  },
  snapshot(session: string) {
    return channel.ask<BrowserSnapshot>("snapshot", { session })
  },
  navigate(session: string, url: string) {
    return channel.ask("navigate", { session, url })
  },
  back(session: string) {
    return channel.ask("back", { session })
  },
  forward(session: string) {
    return channel.ask("forward", { session })
  },
  reload(session: string) {
    return channel.ask("reload", { session })
  },
  resize(session: string, viewport: BrowserViewport) {
    publish({ action: "resize", session, viewport })
  },
  select(session: string) {
    publish({ action: "session.select", session })
  },
  click(request: BrowserPointerRequest) {
    publish({ action: "pointer.click", ...request })
  },
  wheel(request: BrowserWheelRequest) {
    publish({ action: "wheel", ...request })
  },
  type(session: string, text: string) {
    publish({ action: "keyboard.type", session, text })
  },
  press(request: BrowserKeyRequest) {
    publish({ action: "keyboard.press", ...request })
  },
  frames(event: string, receive: (frame: BrowserFrame) => void) {
    return live.subscribe(event, receive)
  },
  startFrames(session: string, event: string) {
    return channel.ask<number>("stream.start", { session, event })
  },
  keepFrames(session: string, event: string) {
    live.publish("stream.keepalive", { session, event })
  },
  stopFrames(session: string, event: string) {
    live.publish("stream.stop", { session, event })
  },
  metrics() {
    return channel.ask<BrowserMetrics>("metrics")
  }
}

function publish(request: BrowserInputRequest) {
  live.publish("input", request)
}
