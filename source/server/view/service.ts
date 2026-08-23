import type { Endpoint } from "@phreshos/core"
import { current, host } from "@phreshos/server"
import docs from "@/api-docs.md?raw"
import ChromiumEngine from "./chromium"
import BrowserSessions from "@server/core/browser-sessions"
import type {
  BrowserInputRequest,
  BrowserKeyRequest,
  BrowserPointerRequest,
  BrowserViewport,
  BrowserWheelRequest
} from "@server/core/browser"

const sessions = new BrowserSessions(new ChromiumEngine())
const owners = new WeakMap<Endpoint, Promise<string>>()

export default async function service() {
  current.answer("session.create", async message => {
    const request = object(message.payload)
    return sessions.create(await owner(message.from), viewport(request.viewport))
  })

  current.answer("session.list", async message => {
    return sessions.workspace(await owner(message.from))
  })

  current.answer("session.close", async message => {
    const request = object(message.payload)
    await sessions.close(await owner(message.from), session(request.session))
  })

  current.answer("snapshot", async message => {
    const request = object(message.payload)
    return sessions.snapshot(await owner(message.from), session(request.session))
  })

  current.answer("navigate", async message => {
    const request = object(message.payload)
    return sessions.navigate(await owner(message.from), session(request.session), navigationUrl(request.url))
  })

  current.answer("back", async message => {
    const request = object(message.payload)
    return sessions.back(await owner(message.from), session(request.session))
  })

  current.answer("forward", async message => {
    const request = object(message.payload)
    return sessions.forward(await owner(message.from), session(request.session))
  })

  current.answer("reload", async message => {
    const request = object(message.payload)
    return sessions.reload(await owner(message.from), session(request.session))
  })

  current.answer("stream.start", async message => {
    const request = object(message.payload)
    const event = streamEvent(request.event)
    return sessions.startFrames(await owner(message.from), session(request.session), event, frame => current.publish(event, frame))
  })

  current.answer("stream.stop", async message => {
    const request = object(message.payload)
    await sessions.stopFrames(await owner(message.from), session(request.session), streamEvent(request.event))
  })

  current.subscribe("stream.keepalive", message => {
    const request = streamControl(message.payload)
    if (!request) return
    void owner(message.from).then(identity => sessions.keepFrames(identity, request.session, request.event)).catch(() => undefined)
  })

  current.subscribe("stream.stop", message => {
    const request = streamControl(message.payload)
    if (!request) return
    void owner(message.from).then(identity => sessions.stopFrames(identity, request.session, request.event)).catch(() => undefined)
  })

  current.subscribe("input", message => {
    let request: BrowserInputRequest

    try {
      request = input(message.payload)
    } catch {
      return
    }

    void owner(message.from).then(identity => performInput(identity, request)).catch(() => undefined)
  })

  current.answer("metrics", () => sessions.metrics())

  host.process.subscribe("exit", ({ process }) => {
    void sessions.closeOwner(process.identity)
  })

  await current.enableService({ name: "browser", docs })
}

function owner(endpoint: Endpoint) {
  const existing = owners.get(endpoint)
  if (existing) return existing

  const identity = endpoint.process().then(process => {
    return process.identity
  })
  owners.set(endpoint, identity)
  return identity
}

function performInput(owner: string, request: BrowserInputRequest) {
  switch (request.action) {
    case "session.select": return sessions.select(owner, request.session)
    case "resize": return sessions.resize(owner, request.session, request.viewport)
    case "pointer.click": return sessions.click(owner, request.session, request.x, request.y, request.button ?? "left")
    case "wheel": return sessions.wheel(owner, request.session, request.deltaX, request.deltaY)
    case "keyboard.type": return sessions.type(owner, request.session, request.text)
    case "keyboard.press": {
      const chord = [...request.modifiers ?? [], request.key].join("+")
      return sessions.press(owner, request.session, chord)
    }
  }
}

function input(value: unknown): BrowserInputRequest {
  const request = object(value)

  switch (request.action) {
    case "session.select": return {
      action: "session.select",
      session: session(request.session)
    }
    case "resize": return {
      action: "resize",
      session: session(request.session),
      viewport: viewport(request.viewport)
    }
    case "pointer.click": return { action: "pointer.click", ...pointer(request) }
    case "wheel": return { action: "wheel", ...wheel(request) }
    case "keyboard.type": return {
      action: "keyboard.type",
      session: session(request.session),
      text: string(request.text, "Keyboard text", 4_096)
    }
    case "keyboard.press": return { action: "keyboard.press", ...key(request) }
    default: throw new Error("The browser input action is invalid")
  }
}

function streamControl(value: unknown) {
  try {
    const request = object(value)
    return { session: session(request.session), event: streamEvent(request.event) }
  } catch {
    return null
  }
}

function streamEvent(value: unknown) {
  const event = string(value, "Browser frame event", 100)
  if (!/^frame:[0-9a-f-]{36}$/.test(event)) throw new Error("The Browser frame event is invalid")
  return event
}

function viewport(value: unknown): BrowserViewport {
  const request = object(value)
  const width = integer(request.width, "Viewport width", 240, 1_920)
  const height = integer(request.height, "Viewport height", 160, 1_080)
  return { width, height }
}

function pointer(value: unknown): BrowserPointerRequest {
  const request = object(value)
  const button = request.button

  if (button !== undefined && button !== "left" && button !== "middle" && button !== "right") {
    throw new Error("The pointer button is invalid")
  }

  return {
    session: session(request.session),
    x: finite(request.x, "Pointer x", 0, 1_920),
    y: finite(request.y, "Pointer y", 0, 1_080),
    ...button && { button }
  }
}

function wheel(value: unknown): BrowserWheelRequest {
  const request = object(value)
  return {
    session: session(request.session),
    deltaX: finite(request.deltaX, "Wheel deltaX", -10_000, 10_000),
    deltaY: finite(request.deltaY, "Wheel deltaY", -10_000, 10_000)
  }
}

function key(value: unknown): BrowserKeyRequest {
  const request = object(value)
  const modifiers = request.modifiers

  if (modifiers !== undefined && (!Array.isArray(modifiers) || modifiers.some(modifier => {
    return modifier !== "Alt" && modifier !== "Control" && modifier !== "Meta" && modifier !== "Shift"
  }))) throw new Error("Keyboard modifiers are invalid")

  return {
    session: session(request.session),
    key: string(request.key, "Keyboard key", 100),
    ...modifiers && { modifiers: modifiers as BrowserKeyRequest["modifiers"] }
  }
}

function navigationUrl(value: unknown) {
  const address = string(value, "Navigation URL", 8_192)
  if (address === "about:blank") return address

  const url = new URL(address)
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Navigation requires an HTTP or HTTPS URL")
  return url.href
}

function session(value: unknown) { return string(value, "Browser session", 100) }

function string(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) throw new Error(`${name} is invalid`)
  return value
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
  if (!Number.isInteger(value)) throw new Error(`${name} must be an integer`)
  return finite(value, name, minimum, maximum)
}

function finite(value: unknown, name: string, minimum: number, maximum: number) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`)
  }
  return value
}

function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("The browser request must be an object")
  return value as Record<string, unknown>
}
