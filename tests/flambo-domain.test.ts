import assert from "node:assert/strict"
import type { BrowserContext, BrowserEngine, BrowserPage } from "../server/core/browser-engine"
import Application, { type WorkspaceClient, type WorkspaceClients } from "../server/core/application"
import type { KeyModifiers, PageState, PointerButton, Viewport } from "../shared/flambo"
import { test } from "vitest"

class FakePage implements BrowserPage {
  public closed = false
  public actions: unknown[][] = []
  private readonly stateListeners = new Set<() => unknown>()
  private readonly loadingListeners = new Set<(loading: boolean) => unknown>()
  private history = ["about:blank"]
  private index = 0
  private favicon: string | null = null
  private heldClick: PromiseWithResolvers<void> | null = null

  public constructor(private viewport: Viewport) {}

  public async state(): Promise<PageState> {
    const url = this.history[this.index] ?? "about:blank"
    return {
      url,
      title: url === "about:blank" ? "" : `Title: ${url}`,
      favicon: this.favicon,
      loading: false,
      canGoBack: this.index > 0,
      canGoForward: this.index < this.history.length - 1,
      viewport: this.viewport
    }
  }

  public async capture() { return Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]) }
  public observeState(listener: () => unknown) { this.stateListeners.add(listener); return () => { this.stateListeners.delete(listener) } }
  public observeLoading(listener: (loading: boolean) => unknown) { this.loadingListeners.add(listener); return () => { this.loadingListeners.delete(listener) } }
  public async observeFrames(_listener: Parameters<BrowserPage["observeFrames"]>[0]) { return () => undefined }

  public async navigate(url: string) {
    this.actions.push(["navigate", url])
    this.history = [...this.history.slice(0, this.index + 1), url]
    this.index += 1
  }

  public async back() { this.actions.push(["back"]); this.index = Math.max(0, this.index - 1) }
  public async forward() { this.actions.push(["forward"]); this.index = Math.min(this.history.length - 1, this.index + 1) }
  public async reload() { this.actions.push(["reload"]) }
  public async resize(viewport: Viewport) { this.actions.push(["resize", viewport]); this.viewport = viewport }
  public async movePointer(x: number, y: number) { this.actions.push(["movePointer", x, y]) }
  public async click(x: number, y: number, button: PointerButton) {
    this.actions.push(["click", x, y, button])
    const held = this.heldClick
    if (!held) return
    this.setLoading(true)
    await held.promise
    this.setLoading(false)
    this.heldClick = null
  }
  public async wheel(deltaX: number, deltaY: number) { this.actions.push(["wheel", deltaX, deltaY]) }
  public async type(text: string) { this.actions.push(["type", text]) }
  public async press(key: string, modifiers: KeyModifiers) { this.actions.push(["press", key, modifiers]) }

  public externalNavigate(url: string, favicon: string | null = null) {
    this.history = [...this.history.slice(0, this.index + 1), url]
    this.index += 1
    this.favicon = favicon
    for (const listener of this.stateListeners) listener()
  }

  public setLoading(loading: boolean) {
    for (const listener of this.loadingListeners) listener(loading)
  }

  public holdNextClick() {
    this.heldClick = Promise.withResolvers<void>()
    return () => this.heldClick?.resolve()
  }

  public async close() { this.closed = true }
}

class FakeContext implements BrowserContext {
  public readonly pages: FakePage[] = []
  public closed = false

  public async open(viewport: Viewport) {
    const page = new FakePage(viewport)
    this.pages.push(page)
    return page
  }

  public async close() { this.closed = true }
}

class FakeEngine implements BrowserEngine {
  public readonly contexts: FakeContext[] = []
  public closed = false

  public async createWorkspace() {
    const context = new FakeContext()
    this.contexts.push(context)
    return context
  }

  public async close() { this.closed = true }
}

class FakeClient implements WorkspaceClient {
  public readonly listeners = new Set<() => unknown>()
  public closed = false

  public constructor(
    public readonly identity: string,
    public readonly assignment: string | undefined
  ) {}

  public subscribeExit(listener: () => unknown) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  public async exited() { return this.closed }
  public async exit() {
    if (this.closed) return
    this.closed = true
    for (const listener of this.listeners) listener()
  }
}

class FakeClients implements WorkspaceClients {
  public readonly values: FakeClient[] = []

  public async create(workspace: string) {
    const client = new FakeClient(`client-${this.values.length + 1}`, workspace)
    this.values.push(client)
    return client
  }
}

function flambo(engine = new FakeEngine(), clients = new FakeClients()) {
  return { application: new Application(engine, clients), engine, clients }
}

const initialViewport = { width: 800, height: 600 } as const

test("Workspace owns ordered revisioned Tab state", async () => {
  const { application, engine } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const changes: number[] = []
  application.subscribe(event => {
    if (event.type === "workspace.changed") changes.push(event.snapshot.revision)
  })

  const initial = await workspace.snapshot()
  assert.equal(initial.revision, 1)
  assert.equal(initial.tabs.length, 1)
  assert.equal(initial.activeTab, initial.tabs[0]?.id)
  assert.deepEqual(initial.tabs[0]?.viewport, initialViewport)

  const first = initial.tabs[0]!
  const second = await workspace.createTab({ width: 1024, height: 768 })
  assert.notEqual(first.id, second.id)
  assert.equal((await workspace.snapshot()).activeTab, second.id)

  await workspace.selectTab(first.id)
  await workspace.selectTab(first.id)
  assert.equal((await workspace.snapshot()).revision, 3)

  await workspace.closeTab(first.id)
  const final = await workspace.snapshot()
  assert.equal(final.revision, 4)
  assert.equal(final.activeTab, second.id)
  assert.deepEqual(final.tabs.map(tab => tab.id), [second.id])
  assert.deepEqual(changes, [2, 3, 4])
  assert.equal(engine.contexts[0]?.pages[0]?.closed, true)
})

test("Application isolates and closes Workspaces", async () => {
  const { application, clients, engine } = flambo()
  const first = await application.createWorkspace(initialViewport)
  const second = await application.createWorkspace(initialViewport)

  assert.deepEqual((await application.listWorkspaces()).map(workspace => workspace.id), [first.id, second.id])
  await application.closeWorkspace(first.id)
  await assert.rejects(() => first.snapshot(), /closed/)
  assert.equal(engine.contexts[0]?.closed, true)
  assert.equal(clients.values[0]?.closed, true)

  await application.dispose()
  assert.equal(engine.contexts[1]?.closed, true)
  assert.equal(clients.values[1]?.closed, true)
  assert.equal(engine.closed, true)
  await assert.rejects(() => application.createWorkspace(initialViewport), /closed/)
})

test("Closing the last Tab closes its Workspace and presenting Client", async () => {
  const { application, clients, engine } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const tab = (await workspace.snapshot()).tabs[0]!

  await application.closeTab(workspace.id, tab.id)

  assert.deepEqual(await application.listWorkspaces(), [])
  assert.equal(engine.contexts[0]?.closed, true)
  assert.equal(engine.contexts[0]?.pages[0]?.closed, true)
  assert.equal(clients.values[0]?.closed, true)
  await assert.rejects(() => workspace.snapshot(), /closed/)
})

test("Tab operations update one authoritative snapshot", async () => {
  const { application, engine } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const created = (await workspace.snapshot()).tabs[0]!

  await workspace.navigate(created.id, "https://example.com/")
  assert.equal((await workspace.snapshot()).tabs[0]?.canGoBack, true)
  assert.equal((await workspace.snapshot()).tabs[0]?.canGoForward, false)
  const frame = await workspace.capture(created.id)
  await workspace.resize(created.id, { width: 1200, height: 700 })
  await workspace.movePointer(created.id, 12, 18)
  await workspace.click(created.id, 24, 30, "left")
  await workspace.wheel(created.id, 0, 140)
  await workspace.type(created.id, "hello")
  await workspace.press(created.id, "Enter", ["Shift"])
  await workspace.reload(created.id)
  await workspace.back(created.id)
  assert.equal((await workspace.snapshot()).tabs[0]?.canGoForward, true)
  await workspace.forward(created.id)

  const snapshot = await workspace.snapshot()
  assert.equal(snapshot.tabs[0]?.url, "https://example.com/")
  assert.equal(snapshot.tabs[0]?.title, "Title: https://example.com/")
  assert.deepEqual(snapshot.tabs[0]?.viewport, { width: 1200, height: 700 })
  assert.deepEqual(frame.data, Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]))
  assert.equal(snapshot.revision, 5)
  assert.deepEqual(engine.contexts[0]?.pages[0]?.actions, [
    ["navigate", "https://example.com/"],
    ["resize", { width: 1200, height: 700 }],
    ["movePointer", 12, 18],
    ["click", 24, 30, "left"],
    ["wheel", 0, 140],
    ["type", "hello"],
    ["press", "Enter", ["Shift"]],
    ["reload"],
    ["back"],
    ["forward"]
  ])
})

test("Page-originated navigation enters the authoritative Workspace revision stream", async () => {
  const { application, engine } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const changed = new Promise<void>(resolve => {
    const release = workspace.subscribe(snapshot => {
      if (snapshot.tabs[0]?.url !== "https://redirected.example/") return
      release()
      resolve()
    })
  })

  const favicon = "data:image/svg+xml;base64,PHN2Zy8+"
  engine.contexts[0]!.pages[0]!.externalNavigate("https://redirected.example/", favicon)
  await changed

  const snapshot = await workspace.snapshot()
  assert.equal(snapshot.revision, 2)
  assert.equal(snapshot.tabs[0]?.url, "https://redirected.example/")
  assert.equal(snapshot.tabs[0]?.favicon, favicon)
})

test("Page loading is published while its initiating operation still owns the Workspace queue", async () => {
  const { application, engine } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const loading: boolean[] = []
  const began = Promise.withResolvers<void>()
  const release = workspace.subscribe(snapshot => {
    const value = snapshot.tabs[0]?.loading
    if (value !== undefined) loading.push(value)
    if (value) began.resolve()
  })

  const page = engine.contexts[0]!.pages[0]!
  const finishClick = page.holdNextClick()
  const click = workspace.click((await workspace.snapshot()).tabs[0]!.id, 10, 10, "left")
  await began.promise
  assert.deepEqual(loading, [true])
  finishClick()
  await click

  release()
  assert.deepEqual(loading, [true, false])
})

test("Client and Workspace share one Process lifetime without treating document reload as termination", async () => {
  const { application, clients } = flambo()
  const workspace = await application.createWorkspace(initialViewport)
  const client = clients.values[0]!

  assert.equal(await application.attachClient(new FakeClient(client.identity, workspace.id), initialViewport), workspace)
  assert.equal((await application.listWorkspaces()).length, 1)

  const closed = new Promise<void>(resolve => {
    const release = application.subscribe(event => {
      if (event.type !== "workspace.closed" || event.workspace !== workspace.id) return
      release()
      resolve()
    })
  })
  await client.exit()
  await closed
  assert.deepEqual(await application.listWorkspaces(), [])
})
