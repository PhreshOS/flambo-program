import assert from "node:assert/strict"
import Application, { type FlamboAPI } from "../client/core/application"
import type { FlamboRequests, FlamboServiceEvents } from "../shared/service"
import type { TabObservationFrame, WorkspaceSnapshot } from "../shared/flambo"
import { test } from "vitest"

class API implements FlamboAPI {
  public readonly requests: Array<[keyof FlamboRequests, unknown]> = []
  public readonly pointerResolvers: Array<() => void> = []
  private readonly listeners = new Map<keyof FlamboServiceEvents, Set<(value: never) => unknown>>()
  private revision = 1
  private pointerObserved: (() => void) | null = null
  private snapshot: WorkspaceSnapshot
  private readonly workspaces = new Map<string, WorkspaceSnapshot>()

  public constructor(blank = false) {
    const tab = Object.freeze({
      id: "tab",
      url: blank ? "about:blank" : "https://start.example/",
      title: blank ? "" : "Start",
      favicon: null,
      loading: false,
      canGoBack: false,
      canGoForward: false,
      viewport: { width: 800, height: 600 }
    })
    this.snapshot = Object.freeze({ id: "workspace", revision: 1, activeTab: tab.id, tabs: [tab] })
    this.workspaces.set(this.snapshot.id, this.snapshot)
  }

  public async request<Event extends keyof FlamboRequests>(event: Event, input: FlamboRequests[Event]["input"]): Promise<FlamboRequests[Event]["output"]> {
    this.requests.push([event, input])
    if (event === "workspace.attach") return this.snapshot as FlamboRequests[Event]["output"]
    if (event === "workspace.list") return [...this.workspaces.values()] as FlamboRequests[Event]["output"]
    if (event === "workspace.create") {
      const viewport = (input as { viewport: { width: number, height: number } }).viewport
      const tab = Object.freeze({ id: `tab-${this.workspaces.size + 1}`, url: "about:blank", title: "", favicon: null, loading: false, canGoBack: false, canGoForward: false, viewport })
      const workspace = Object.freeze({ id: `workspace-${this.workspaces.size + 1}`, revision: 1, activeTab: tab.id, tabs: [tab] })
      this.workspaces.set(workspace.id, workspace)
      this.emit("workspace.changed", workspace)
      return workspace as FlamboRequests[Event]["output"]
    }
    if (event === "workspace.read") {
      const snapshot = this.workspaces.get((input as { workspace: string }).workspace)
      if (!snapshot) throw new Error("Missing test Workspace")
      return snapshot as FlamboRequests[Event]["output"]
    }
    if (event === "tab.create") {
      const tab = Object.freeze({ id: "tab", url: "about:blank", title: "", favicon: null, loading: false, canGoBack: false, canGoForward: false, viewport: { width: 800, height: 600 } })
      this.snapshot = Object.freeze({ id: "workspace", revision: ++this.revision, activeTab: tab.id, tabs: [tab] })
      this.workspaces.set(this.snapshot.id, this.snapshot)
      this.emit("workspace.changed", this.snapshot)
      return tab as FlamboRequests[Event]["output"]
    }
    if (event === "tab.observe") return frame(1) as FlamboRequests[Event]["output"]
    if (event === "tab.movePointer") return await new Promise<FlamboRequests[Event]["output"]>(resolve => {
      this.pointerResolvers.push(() => resolve(this.snapshot as FlamboRequests[Event]["output"]))
      this.pointerObserved?.()
      this.pointerObserved = null
    })
    if (event === "tab.navigate") {
      const tab = Object.freeze({ ...this.snapshot.tabs[0]!, url: (input as { url: string }).url })
      this.snapshot = Object.freeze({ ...this.snapshot, revision: ++this.revision, tabs: [tab] })
      this.workspaces.set(this.snapshot.id, this.snapshot)
      this.emit("workspace.changed", this.snapshot)
      return tab as FlamboRequests[Event]["output"]
    }
    return null as FlamboRequests[Event]["output"]
  }

  public subscribe<Event extends keyof FlamboServiceEvents>(event: Event, receive: (value: FlamboServiceEvents[Event]) => unknown) {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(receive as (value: never) => unknown)
    this.listeners.set(event, listeners)
    return () => { listeners.delete(receive as (value: never) => unknown) }
  }

  public emit<Event extends keyof FlamboServiceEvents>(event: Event, value: FlamboServiceEvents[Event]) {
    for (const receive of this.listeners.get(event) ?? []) receive(value as never)
  }

  public add(snapshot: WorkspaceSnapshot) {
    this.workspaces.set(snapshot.id, snapshot)
    this.emit("workspace.changed", snapshot)
  }

  public releasePointer() { this.pointerResolvers.shift()?.() }
  public nextPointerRequest() { return new Promise<void>(resolve => { this.pointerObserved = resolve }) }
}

function frame(sequence: number): TabObservationFrame {
  return Object.freeze({
    observation: "observation",
    sequence,
    tab: "tab",
    viewport: { width: 800, height: 600 },
    mimeType: "image/jpeg",
    data: Uint8Array.from([sequence])
  })
}

test("Client subscribes before reading and reconciles the authoritative Workspace", async () => {
  const api = new API()
  const application = new Application(api)
  await application.start({ width: 800, height: 600 })

  const state = application.snapshot()
  assert.equal(state.status, "ready")
  assert.equal(state.workspace?.activeTab, "tab")
  assert.equal(state.frame?.sequence, 1)
  assert.deepEqual(api.requests.map(([event]) => event), [
    "workspace.attach",
    "tab.observe"
  ])
  assert.deepEqual(api.requests[0]?.[1], { viewport: { width: 800, height: 600 } })

  api.emit("tab.frame", frame(2))
  application.acknowledge(application.snapshot().frame!)
  assert.equal(application.snapshot().frame?.sequence, 2)
  assert.equal(api.requests.at(-1)?.[0], "tab.acknowledge")

  await application.navigate("tab", "https://example.com/")
  assert.equal(application.snapshot().workspace?.tabs[0]?.url, "https://example.com/")
  application.dispose()
})

test("Client initialization is one operation while the same document is opening", async () => {
  const api = new API()
  const application = new Application(api)

  await Promise.all([
    application.start({ width: 800, height: 600 }),
    application.start({ width: 800, height: 600 })
  ])

  assert.equal(api.requests.filter(([event]) => event === "workspace.attach").length, 1)
  assert.equal(api.requests.filter(([event]) => event === "workspace.create").length, 0)
  assert.equal(api.requests.filter(([event]) => event === "tab.create").length, 0)
  application.dispose()
})

test("Client starts page observation when a local welcome Tab first navigates", async () => {
  const api = new API(true)
  const application = new Application(api)
  await application.start({ width: 800, height: 600 })

  assert.equal(application.snapshot().workspace?.tabs[0]?.url, "about:blank")
  assert.equal(application.snapshot().frame, null)
  assert.deepEqual(api.requests.map(([event]) => event), [
    "workspace.attach"
  ])

  await application.navigate("tab", "https://example.com/")
  assert.equal(api.requests.filter(([event]) => event === "tab.observe").length, 1)
  assert.equal(application.snapshot().frame?.sequence, 1)
  application.dispose()
})

test("Creating another Workspace leaves this Client attached to its own Workspace", async () => {
  const api = new API()
  const application = new Application(api)
  await application.start({ width: 800, height: 600 })
  const other = await application.createWorkspace({ width: 1200, height: 700 })

  assert.notEqual(other.id, "workspace")
  assert.equal(application.snapshot().workspace?.id, "workspace")
  application.dispose()
})

test("Client pointer motion retains only the newest position behind the in-flight request", async () => {
  const api = new API()
  const application = new Application(api)
  await application.start({ width: 800, height: 600 })

  const first = application.movePointer("tab", 1, 1)
  const second = application.movePointer("tab", 2, 2)
  const third = application.movePointer("tab", 3, 3)

  assert.deepEqual(api.requests.filter(([event]) => event === "tab.movePointer").map(([, input]) => input), [
    { workspace: "workspace", tab: "tab", x: 1, y: 1 }
  ])

  const nextRequest = api.nextPointerRequest()
  api.releasePointer()
  await nextRequest

  assert.deepEqual(api.requests.filter(([event]) => event === "tab.movePointer").map(([, input]) => input), [
    { workspace: "workspace", tab: "tab", x: 1, y: 1 },
    { workspace: "workspace", tab: "tab", x: 3, y: 3 }
  ])

  api.releasePointer()
  await Promise.all([first, second, third])
  application.dispose()
})
