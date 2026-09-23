import { randomUUID } from "node:crypto"
import type { BrowserContext, BrowserPage } from "./browser-engine"
import type { KeyModifiers, PointerButton, TabFrame, TabSnapshot, Viewport, WorkspaceSnapshot } from "../../shared/flambo"

type Tab = {
  readonly id: string
  readonly page: BrowserPage
  releaseState: () => void
  state: TabSnapshot
}

/** Owns one authoritative Flambo Workspace and its ordered Tab state. */
export default class Workspace {
  private readonly tabs = new Map<string, Tab>()
  private readonly listeners = new Set<(snapshot: WorkspaceSnapshot) => unknown>()
  private queue: Promise<void> = Promise.resolve()
  private revision = 0
  private activeTab: string | null = null
  private closing: Promise<void> | null = null

  public constructor(
    public readonly id: string,
    private readonly context: BrowserContext
  ) {}

  public snapshot(): Promise<WorkspaceSnapshot> {
    return this.schedule(() => this.current())
  }

  public createTab(viewport: Viewport): Promise<TabSnapshot> {
    return this.mutate(async () => {
      const page = await this.context.open(viewport)
      const id = randomUUID()

      try {
        const state = freezeTab({ id, ...await page.state() })
        const tab: Tab = { id, page, state, releaseState: () => undefined }
        this.tabs.set(id, tab)
        // Page-originated redirects and navigations enter the same serialized
        // Workspace revision path as explicit Flambo operations.
        tab.releaseState = page.observeState(() => {
          void this.refreshTab(id).catch(() => undefined)
        })
        this.activeTab = id
        return state
      } catch (error) {
        await page.close().catch(() => undefined)
        throw error
      }
    })
  }

  public closeTab(id: string): Promise<void> {
    return this.mutate(async () => {
      const tab = this.requireTab(id)
      const ids = [...this.tabs.keys()]
      const index = ids.indexOf(id)

      this.tabs.delete(id)
      tab.releaseState()
      if (this.activeTab === id) this.activeTab = ids[index + 1] ?? ids[index - 1] ?? null
      await tab.page.close()
    })
  }

  public selectTab(id: string): Promise<void> {
    return this.mutate(async () => {
      this.requireTab(id)
      this.activeTab = id
    })
  }

  public navigate(id: string, url: string) {
    return this.act(id, page => page.navigate(url))
  }

  public back(id: string) {
    return this.act(id, page => page.back())
  }

  public forward(id: string) {
    return this.act(id, page => page.forward())
  }

  public reload(id: string) {
    return this.act(id, page => page.reload())
  }

  public capture(id: string): Promise<TabFrame> {
    return this.schedule(async () => {
      const tab = this.requireTab(id)
      return Object.freeze({
        tab: id,
        viewport: tab.state.viewport,
        mimeType: "image/jpeg" as const,
        data: await tab.page.capture()
      })
    })
  }

  public observeFrames(id: string, listener: Parameters<BrowserPage["observeFrames"]>[0]) {
    return this.schedule(() => this.requireTab(id).page.observeFrames(listener))
  }

  public resize(id: string, viewport: Viewport) {
    return this.act(id, page => page.resize(viewport))
  }

  public movePointer(id: string, x: number, y: number) {
    return this.act(id, page => page.movePointer(x, y))
  }

  public click(id: string, x: number, y: number, button: PointerButton) {
    return this.act(id, page => page.click(x, y, button))
  }

  public wheel(id: string, deltaX: number, deltaY: number) {
    return this.act(id, page => page.wheel(deltaX, deltaY))
  }

  public type(id: string, text: string) {
    return this.act(id, page => page.type(text))
  }

  public press(id: string, key: string, modifiers: KeyModifiers) {
    return this.act(id, page => page.press(key, modifiers))
  }

  public subscribe(listener: (snapshot: WorkspaceSnapshot) => unknown) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  public close(): Promise<void> {
    if (!this.closing) this.closing = this.finishClose()
    return this.closing
  }

  private async finishClose() {
    await this.queue
    const tabs = [...this.tabs.values()]
    this.tabs.clear()
    this.activeTab = null
    for (const tab of tabs) tab.releaseState()
    await Promise.allSettled(tabs.map(tab => tab.page.close()))
    await this.context.close()
    this.listeners.clear()
  }

  private mutate<Result>(operation: () => Promise<Result>): Promise<Result> {
    return this.schedule(async () => {
      const before = this.signature()
      const result = await operation()

      if (before !== this.signature()) {
        this.revision += 1
        const snapshot = this.current()
        for (const listener of this.listeners) listener(snapshot)
      }

      return result
    })
  }

  private act(id: string, operation: (page: BrowserPage) => Promise<void>) {
    return this.mutate(async () => {
      const tab = this.requireTab(id)
      await operation(tab.page)
      tab.state = freezeTab({ id, ...await tab.page.state() })
      return tab.state
    })
  }

  private refreshTab(id: string) {
    return this.mutate(async () => {
      const tab = this.requireTab(id)
      tab.state = freezeTab({ id, ...await tab.page.state() })
    })
  }

  private schedule<Result>(operation: () => Promise<Result> | Result): Promise<Result> {
    if (this.closing) return Promise.reject(new Error("The Flambo Workspace is closed"))
    const task = this.queue.then(operation)
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  private requireTab(id: string) {
    const tab = this.tabs.get(id)
    if (!tab) throw new Error("The Flambo Tab does not exist in this Workspace")
    return tab
  }

  private signature() {
    return JSON.stringify([
      this.activeTab,
      [...this.tabs.values()].map(tab => tab.state)
    ])
  }

  private current(): WorkspaceSnapshot {
    return Object.freeze({
      id: this.id,
      revision: this.revision,
      activeTab: this.activeTab,
      tabs: Object.freeze([...this.tabs.values()].map(tab => tab.state))
    })
  }
}

function freezeTab(tab: TabSnapshot): TabSnapshot {
  return Object.freeze({
    ...tab,
    viewport: Object.freeze({ ...tab.viewport })
  })
}
