import type {
  BrowserFrame,
  BrowserInputRequest,
  BrowserKeyRequest,
  BrowserPointerRequest,
  BrowserSnapshot,
  BrowserViewport,
  BrowserWheelRequest,
  BrowserWorkspace,
  BrowserWorkspaceLifecycle
} from "@server/core/browser"

export interface WorkspaceBoundary {
  ask<Answer = unknown>(event: string, payload?: unknown): Promise<Answer>
  publish(event: string, payload: unknown): void
  subscribe(event: string, receive: (payload: unknown) => void): () => void
}

/** A Client-local peer for one authoritative Flambo workspace. */
export default class Workspace {
  public readonly identity: string
  public readonly lifecycle: BrowserWorkspaceLifecycle
  private current: BrowserWorkspace
  private readonly listeners = new Set<() => void>()
  private closed = false
  private closing: Promise<void> | null = null

  public constructor(
    snapshot: BrowserWorkspace,
    private readonly boundary: WorkspaceBoundary,
    private readonly release: () => void
  ) {
    this.identity = snapshot.workspace
    this.lifecycle = snapshot.lifecycle
    this.current = snapshot
  }

  public get active() { return this.current.active }
  public get sessions() { return this.current.sessions }

  public subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public synchronize(snapshot: BrowserWorkspace) {
    if (this.closed) return
    if (snapshot.workspace !== this.identity || snapshot.lifecycle !== this.lifecycle) {
      throw new Error("Flambo returned a different browser workspace")
    }
    if (snapshot.revision <= this.current.revision) return
    this.current = snapshot
    for (const listener of this.listeners) listener()
  }

  public async snapshot() {
    this.ensureOpen()
    const snapshot = await this.boundary.ask<BrowserWorkspace>("workspace.read", { workspace: this.identity })
    this.synchronize(snapshot)
    return snapshot
  }

  public create(viewport: BrowserViewport) {
    return this.ask<BrowserSnapshot>("session.create", { viewport })
  }

  public closeSession(session: string) { return this.ask("session.close", { session }) }
  public capture(session: string) { return this.ask<BrowserSnapshot>("snapshot", { session }) }
  public navigate(session: string, url: string) { return this.ask("navigate", { session, url }) }
  public back(session: string) { return this.ask("back", { session }) }
  public forward(session: string) { return this.ask("forward", { session }) }
  public reload(session: string) { return this.ask("reload", { session }) }

  public resize(session: string, viewport: BrowserViewport) {
    return this.input({ action: "resize", workspace: this.identity, session, viewport })
  }

  public select(session: string) {
    return this.input({ action: "session.select", workspace: this.identity, session })
  }

  public click(request: BrowserPointerRequest) {
    return this.input({ action: "pointer.click", workspace: this.identity, ...request })
  }

  public wheel(request: BrowserWheelRequest) {
    return this.input({ action: "wheel", workspace: this.identity, ...request })
  }

  public type(session: string, text: string) {
    return this.input({ action: "keyboard.type", workspace: this.identity, session, text })
  }

  public press(request: BrowserKeyRequest) {
    return this.input({ action: "keyboard.press", workspace: this.identity, ...request })
  }

  public frames(event: string, receive: (frame: BrowserFrame) => void) {
    this.ensureOpen()
    return this.boundary.subscribe(event, payload => receive(payload as BrowserFrame))
  }

  public startFrames(session: string, event: string) {
    return this.ask<number>("stream.start", { session, event })
  }

  public keepFrames(session: string, event: string) {
    this.publish("stream.keepalive", { session, event })
  }

  public stopFrames(session: string, event: string) {
    this.publish("stream.stop", { session, event })
  }

  public close() {
    if (this.closed) return Promise.resolve()
    if (this.closing) return this.closing

    this.closing = this.boundary.ask("workspace.close", { workspace: this.identity }).then(() => {
      this.closed = true
      this.listeners.clear()
      this.release()
    }, error => {
      this.closing = null
      throw error
    })
    return this.closing
  }

  public invalidate() {
    if (this.closed) return
    this.closed = true
    this.listeners.clear()
    this.release()
  }

  private ask<Answer = unknown>(event: string, payload: Record<string, unknown>) {
    this.ensureOpen()
    return this.boundary.ask<Answer>(event, { workspace: this.identity, ...payload })
  }

  private publish(event: string, payload: Record<string, unknown>) {
    this.ensureOpen()
    this.boundary.publish(event, { workspace: this.identity, ...payload })
  }

  private input(request: BrowserInputRequest) {
    this.ensureOpen()
    return this.boundary.ask("input", request)
  }

  private ensureOpen() {
    if (this.closed || this.closing) throw new Error("The browser workspace is closed")
  }
}
