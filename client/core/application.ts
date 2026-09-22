import type { TabObservationFrame, TabSnapshot, Viewport, WorkspaceSnapshot } from "../../shared/browser"
import type { BrowserRequests, BrowserServiceEvents } from "../../shared/service"

export interface BrowserAPI {
  request<Event extends keyof BrowserRequests>(
    event: Event,
    input: BrowserRequests[Event]["input"]
  ): Promise<BrowserRequests[Event]["output"]>
  subscribe<Event extends keyof BrowserServiceEvents>(
    event: Event,
    receive: (value: BrowserServiceEvents[Event]) => unknown
  ): () => void
}

export type BrowserState = Readonly<{
  status: "connecting" | "ready" | "failed"
  workspace: WorkspaceSnapshot | null
  frame: TabObservationFrame | null
  error: string | null
}>

/** Maintains one Client's live projection of an authoritative Workspace. */
export default class Application {
  private state: BrowserState = { status: "connecting", workspace: null, frame: null, error: null }
  private readonly listeners = new Set<() => void>()
  private readonly release: Array<() => void>
  private workspace: string | null = null
  private observation: string | null = null
  private observedTab: string | null = null
  private observationGeneration = 0
  private buffered: WorkspaceSnapshot[] | null = null
  private loading: Promise<void> | null = null
  private disposed = false
  private readonly wheelQueues = new Map<string, { deltaX: number, deltaY: number, running: Promise<TabSnapshot> | null }>()
  private readonly pointerQueues = new Map<string, { pending: Readonly<{ x: number, y: number }> | null, running: Promise<TabSnapshot> | null }>()

  public constructor(private readonly api: BrowserAPI) {
    this.release = [
      api.subscribe("workspace.changed", snapshot => {
        this.buffered?.push(snapshot)
        this.receiveWorkspace(snapshot)
      }),
      api.subscribe("workspace.closed", event => {
        this.removeWorkspace(event.workspace)
      }),
      api.subscribe("tab.frame", frame => this.receiveFrame(frame))
    ]
  }

  public readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  public readonly snapshot = () => this.state

  public start(viewport: Viewport = { width: 1024, height: 720 }): Promise<void> {
    if (this.loading) return this.loading
    this.set({ status: "connecting", error: null })
    this.buffered = []

    const loading = (async () => {
      const initial = await this.api.request("workspace.attach", undefined)
      this.workspace = initial.id
      this.receiveWorkspace(initial)

      // The subscription is established before the snapshot read so no revision can be lost in between.
      for (const snapshot of this.buffered ?? []) this.receiveWorkspace(snapshot)
      this.buffered = null

      let current = this.state.workspace
      if (current && current.tabs.length === 0) {
        await this.api.request("tab.create", { workspace: current.id, viewport })
        current = await this.api.request("workspace.read", { workspace: current.id })
        this.receiveWorkspace(current)
      }
      this.set({ status: "ready" })
      await this.observeActiveTab()
    })().catch(error => this.fail(error)).finally(() => {
      this.buffered = null
      this.loading = null
    })

    this.loading = loading
    return loading
  }

  public createWorkspace() {
    // Creating another Workspace creates another Client; this Client keeps
    // presenting the Workspace that defines its own lifetime.
    return this.api.request("workspace.create", undefined)
  }

  public async createTab(viewport: Viewport) {
    const workspace = this.requireWorkspace()
    await this.api.request("tab.create", { workspace: workspace.id, viewport })
  }

  public async closeTab(tab: string) {
    await this.api.request("tab.close", { workspace: this.requireWorkspace().id, tab })
  }

  public async selectTab(tab: string) {
    await this.api.request("tab.select", { workspace: this.requireWorkspace().id, tab })
  }

  public async navigate(tab: string, url: string) {
    return this.updateTab(await this.api.request("tab.navigate", {
      workspace: this.requireWorkspace().id,
      tab,
      url
    }))
  }

  public async back(tab: string) { return this.updateTab(await this.tabRequest("tab.back", tab)) }
  public async forward(tab: string) { return this.updateTab(await this.tabRequest("tab.forward", tab)) }
  public async reload(tab: string) { return this.updateTab(await this.tabRequest("tab.reload", tab)) }

  public async resize(tab: string, viewport: Viewport) {
    const current = this.requireWorkspace().tabs.find(candidate => candidate.id === tab)
    if (current?.viewport.width === viewport.width && current.viewport.height === viewport.height) return current
    return this.updateTab(await this.api.request("tab.resize", {
      workspace: this.requireWorkspace().id,
      tab,
      viewport
    }))
  }

  public async click(tab: string, x: number, y: number, button: "left" | "middle" | "right") {
    return this.updateTab(await this.api.request("tab.click", {
      workspace: this.requireWorkspace().id,
      tab,
      x,
      y,
      button
    }))
  }

  public movePointer(tab: string, x: number, y: number) {
    const queue = this.pointerQueues.get(tab) ?? { pending: null, running: null }
    queue.pending = { x, y }
    this.pointerQueues.set(tab, queue)
    // Pointer motion is a latest-state stream: one request may be in flight
    // while exactly one newest position is retained behind it.
    queue.running ??= this.flushPointer(tab, queue)
    return queue.running
  }

  public wheel(tab: string, deltaX: number, deltaY: number) {
    const queue = this.wheelQueues.get(tab) ?? { deltaX: 0, deltaY: 0, running: null }
    queue.deltaX += deltaX
    queue.deltaY += deltaY
    this.wheelQueues.set(tab, queue)
    // Each completed request signals the next batch; native wheel bursts never fan out into parallel asks.
    queue.running ??= this.flushWheel(tab, queue)
    return queue.running
  }

  public async type(tab: string, text: string) {
    return this.updateTab(await this.api.request("tab.type", {
      workspace: this.requireWorkspace().id,
      tab,
      text
    }))
  }

  public async press(tab: string, key: string, modifiers: readonly ("Alt" | "Control" | "Meta" | "Shift")[] = []) {
    return this.updateTab(await this.api.request("tab.press", {
      workspace: this.requireWorkspace().id,
      tab,
      key,
      modifiers
    }))
  }

  public acknowledge(frame: TabObservationFrame) {
    if (frame.observation !== this.observation || this.state.frame !== frame) return
    void this.api.request("tab.acknowledge", {
      observation: frame.observation,
      sequence: frame.sequence
    }).catch(error => this.fail(error))
  }

  public fail(error: unknown) {
    this.set({ status: "failed", error: error instanceof Error ? error.message : String(error) })
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    this.observationGeneration += 1
    const observation = this.observation
    this.observation = null
    this.observedTab = null
    if (observation) void this.api.request("tab.unobserve", { observation }).catch(() => undefined)
    for (const release of this.release) release()
    this.listeners.clear()
  }

  private async flushWheel(tab: string, queue: { deltaX: number, deltaY: number, running: Promise<TabSnapshot> | null }) {
    let result = this.requireWorkspace().tabs.find(candidate => candidate.id === tab)
    if (!result) throw new Error("The browser Tab does not exist in this Workspace")
    try {
      while (queue.deltaX !== 0 || queue.deltaY !== 0) {
        const deltaX = queue.deltaX
        const deltaY = queue.deltaY
        queue.deltaX = 0
        queue.deltaY = 0
        result = this.updateTab(await this.api.request("tab.wheel", {
          workspace: this.requireWorkspace().id,
          tab,
          deltaX,
          deltaY
        }))
      }
      return result
    } finally {
      this.wheelQueues.delete(tab)
    }
  }

  private async flushPointer(tab: string, queue: { pending: Readonly<{ x: number, y: number }> | null, running: Promise<TabSnapshot> | null }) {
    let result = this.requireWorkspace().tabs.find(candidate => candidate.id === tab)
    if (!result) throw new Error("The browser Tab does not exist in this Workspace")
    try {
      while (queue.pending) {
        const point = queue.pending
        queue.pending = null
        result = this.updateTab(await this.api.request("tab.movePointer", {
          workspace: this.requireWorkspace().id,
          tab,
          ...point
        }))
      }
      return result
    } finally {
      this.pointerQueues.delete(tab)
    }
  }

  private async tabRequest(event: "tab.back" | "tab.forward" | "tab.reload", tab: string) {
    return this.api.request(event, { workspace: this.requireWorkspace().id, tab })
  }

  private receiveWorkspace(snapshot: WorkspaceSnapshot) {
    if (snapshot.id !== this.workspace) return
    if (this.state.workspace && snapshot.revision < this.state.workspace.revision) return
    const activeChanged = snapshot.activeTab !== this.state.workspace?.activeTab
    this.set({ workspace: snapshot })
    if (activeChanged && this.state.status === "ready") {
      void this.observeActiveTab().catch(error => this.fail(error))
    }
  }

  private updateTab(tab: TabSnapshot) {
    const workspace = this.requireWorkspace()
    const tabs = workspace.tabs.map(current => current.id === tab.id ? tab : current)
    this.set({ workspace: Object.freeze({ ...workspace, tabs: Object.freeze(tabs) }) })
    return tab
  }

  private receiveFrame(frame: TabObservationFrame) {
    if (frame.observation !== this.observation) return
    if (this.state.frame?.observation === frame.observation && this.state.frame.sequence >= frame.sequence) return
    this.set({ frame })
  }

  private async observeActiveTab() {
    const tab = this.state.workspace?.activeTab ?? null
    if (tab === this.observedTab) return
    const generation = ++this.observationGeneration
    const previous = this.observation
    this.observation = null
    this.observedTab = tab
    this.set({ frame: null })
    if (previous) await this.api.request("tab.unobserve", { observation: previous }).catch(() => undefined)
    if (!tab || this.disposed || generation !== this.observationGeneration) return

    const frame = await this.api.request("tab.observe", {
      workspace: this.requireWorkspace().id,
      tab
    })
    if (this.disposed || generation !== this.observationGeneration) {
      await this.api.request("tab.unobserve", { observation: frame.observation }).catch(() => undefined)
      return
    }
    this.observation = frame.observation
    this.receiveFrame(frame)
  }

  private removeWorkspace(workspace: string) {
    if (workspace !== this.workspace) return

    void this.releaseObservation()
    this.workspace = null
    this.set({ workspace: null, frame: null, status: "ready" })
  }

  private async releaseObservation() {
    this.observationGeneration += 1
    const observation = this.observation
    this.observation = null
    this.observedTab = null
    if (observation) await this.api.request("tab.unobserve", { observation }).catch(() => undefined)
  }

  private requireWorkspace() {
    if (!this.state.workspace) throw new Error("The browser Workspace is not ready")
    return this.state.workspace
  }

  private set(patch: Partial<BrowserState>) {
    if (this.disposed) return
    this.state = Object.freeze({ ...this.state, ...patch })
    for (const listener of this.listeners) listener()
  }
}
