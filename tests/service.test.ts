import assert from "node:assert/strict"
import type { Endpoint } from "@phreshos/core"
import type { BrowserContext, BrowserEngine, BrowserPage } from "../server/core/browser-engine"
import Application, { type WorkspaceClient, type WorkspaceClients } from "../server/core/application"
import { serve, type ServiceBoundary } from "../server/view/service"
import type { KeyModifiers, PageState, PointerButton, Viewport } from "../shared/flambo"
import { test } from "vitest"

class Page implements BrowserPage {
  private readonly frameListeners = new Set<Parameters<BrowserPage["observeFrames"]>[0]>()
  private readonly stateListeners = new Set<() => unknown>()
  private current: PageState

  public constructor(viewport: Viewport) {
    this.current = { url: "about:blank", title: "", canGoBack: false, canGoForward: false, viewport }
  }

  public async state() { return this.current }
  public observeState(listener: () => unknown) { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener) } }
  public async capture() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) }
  public async observeFrames(listener: Parameters<BrowserPage["observeFrames"]>[0]) {
    this.frameListeners.add(listener)
    return () => { this.frameListeners.delete(listener) }
  }
  public frame(value: number) {
    for (const listener of this.frameListeners) {
      listener({ viewport: this.current.viewport, data: Uint8Array.from([value]) })
    }
  }
  public async navigate(url: string) { this.current = { ...this.current, url, title: url, canGoBack: true } }
  public async back() {}
  public async forward() {}
  public async reload() {}
  public async resize(viewport: Viewport) { this.current = { ...this.current, viewport } }
  public async movePointer(_x: number, _y: number) {}
  public async click(_x: number, _y: number, _button: PointerButton) {}
  public async wheel(_deltaX: number, _deltaY: number) {}
  public async type(_text: string) {}
  public async press(_key: string, _modifiers: KeyModifiers) {}
  public async close() {}
}

class Context implements BrowserContext {
  public readonly pages: Page[] = []
  public async open(viewport: Viewport) {
    const page = new Page(viewport)
    this.pages.push(page)
    return page
  }
  public async close() {}
}

class Engine implements BrowserEngine {
  public readonly contexts: Context[] = []
  public async createWorkspace() {
    const context = new Context()
    this.contexts.push(context)
    return context
  }
  public async close() {}
}

class Clients implements WorkspaceClients {
  private count = 0

  public async create(workspace: string): Promise<WorkspaceClient> {
    let closed = false
    const listeners = new Set<() => unknown>()
    return {
      identity: `client-${++this.count}`,
      assignment: workspace,
      subscribeExit(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
      async exited() { return closed },
      async exit() {
        if (closed) return
        closed = true
        for (const listener of listeners) listener()
      }
    }
  }
}

function application(engine = new Engine()) {
  return new Application(engine, new Clients())
}

class Boundary implements ServiceBoundary {
  public readonly handlers = new Map<string, (message: { payload: unknown, from?: Endpoint | null }) => unknown>()
  public readonly publications: Array<[string, unknown]> = []

  public answer(event: string, handler: (message: { payload: unknown, from?: Endpoint | null }) => unknown) {
    this.handlers.set(event, handler)
  }

  public publish(event: string, payload: unknown) {
    this.publications.push([event, payload])
  }

  public async ask(event: string, payload?: unknown, from?: Endpoint) {
    const handler = this.handlers.get(event)
    if (!handler) throw new Error(`No handler for ${event}`)
    return await handler({ payload, from })
  }
}

function owner() {
  const listeners = new Set<() => unknown>()
  return {
    endpoint: {
      lifecycle: {
        subscribe: (event: string, listener: () => unknown) => {
          assert.equal(event, "stop")
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        }
      }
    } as unknown as Endpoint,
    stop: () => { for (const listener of listeners) listener() }
  }
}

function workspaceOwner(identity = "flambo-client") {
  const exits = new Set<() => unknown>()
  let ended = false
  let endpoint: Endpoint
  const process = {
    identity,
    get client() { return endpoint },
    options: async () => undefined,
    subscribe: (event: string, listener: () => unknown) => {
      assert.equal(event, "exit")
      exits.add(listener)
      return () => { exits.delete(listener) }
    },
    exited: async () => ended,
    exit: async () => {
      if (ended) return
      ended = true
      for (const listener of exits) listener()
    }
  }
  endpoint = {
    process: async () => process
  } as unknown as Endpoint
  return { endpoint, process }
}

test("Service requests and publications preserve authoritative revisions", async () => {
  const flambo = application()
  const boundary = new Boundary()
  serve(flambo, boundary)

  const workspace = await boundary.ask("workspace.create") as { id: string }
  const tab = await boundary.ask("tab.create", {
    workspace: workspace.id,
    viewport: { width: 900, height: 600 }
  }) as { id: string }
  await boundary.ask("tab.navigate", {
    workspace: workspace.id,
    tab: tab.id,
    url: "https://example.com/"
  })
  const frame = await boundary.ask("tab.capture", {
    workspace: workspace.id,
    tab: tab.id
  }) as { mimeType: string, data: Uint8Array }

  const read = await boundary.ask("workspace.read", { workspace: workspace.id }) as {
    revision: number
    tabs: Array<{ url: string }>
  }
  assert.equal(read.revision, 2)
  assert.equal(read.tabs[0]?.url, "https://example.com/")
  assert.equal(frame.mimeType, "image/jpeg")
  assert.deepEqual(frame.data, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))
  assert.deepEqual(boundary.publications.map(([event, payload]) => [event, (payload as { revision?: number }).revision]), [
    ["workspace.changed", 0],
    ["workspace.changed", 1],
    ["workspace.changed", 2]
  ])

  await boundary.ask("workspace.close", { workspace: workspace.id })
  assert.deepEqual(boundary.publications.at(-1), ["workspace.closed", { workspace: workspace.id }])
  await assert.rejects(() => boundary.ask("workspace.read", { workspace: workspace.id }), /does not exist/)
})

test("Service rejects invalid input at its boundary", async () => {
  const boundary = new Boundary()
  serve(application(), boundary)
  await assert.rejects(() => boundary.ask("tab.create", {
    workspace: "missing",
    viewport: { width: 0, height: 600 }
  }), /expected number to be >0/)
})

test("Service reattaches one Client Process and closes both sides as one lifetime", async () => {
  const flambo = application()
  const boundary = new Boundary()
  const owner = workspaceOwner()
  serve(flambo, boundary)

  const first = await boundary.ask("workspace.attach", undefined, owner.endpoint) as { id: string }
  const reloaded = await boundary.ask("workspace.attach", undefined, owner.endpoint) as { id: string }
  assert.equal(reloaded.id, first.id)
  assert.equal((await flambo.listWorkspaces()).length, 1)

  await boundary.ask("workspace.close", { workspace: first.id })
  assert.equal(await owner.process.exited(), true)
  await assert.rejects(() => boundary.ask("workspace.read", { workspace: first.id }), /does not exist/)
})

test("Tab observation applies acknowledgement backpressure and releases with its Client", async () => {
  const engine = new Engine()
  const boundary = new Boundary()
  serve(application(engine), boundary)
  const client = owner()
  const workspace = await boundary.ask("workspace.create") as { id: string }
  const tab = await boundary.ask("tab.create", {
    workspace: workspace.id,
    viewport: { width: 900, height: 600 }
  }) as { id: string }

  const first = await boundary.ask("tab.observe", {
    workspace: workspace.id,
    tab: tab.id
  }, client.endpoint) as { observation: string, sequence: number, data: Uint8Array }

  assert.equal(first.sequence, 1)
  engine.contexts[0]!.pages[0]!.frame(1)
  engine.contexts[0]!.pages[0]!.frame(2)
  assert.equal(boundary.publications.filter(([event]) => event === "tab.frame").length, 0)

  await boundary.ask("tab.acknowledge", {
    observation: first.observation,
    sequence: first.sequence
  }, client.endpoint)
  const delivered = boundary.publications.find(([event]) => event === "tab.frame")?.[1] as {
    sequence: number
    data: Uint8Array
  }
  assert.equal(delivered.sequence, 2)
  assert.deepEqual(delivered.data, Uint8Array.from([2]))

  client.stop()
  await assert.rejects(() => boundary.ask("tab.acknowledge", {
    observation: first.observation,
    sequence: delivered.sequence
  }, client.endpoint), /does not exist/)
})
