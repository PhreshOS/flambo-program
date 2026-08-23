import type { BrowserFrame, BrowserViewport, BrowserWorkspace, BrowserWorkspaceLifecycle } from "./browser"
import type BrowserSessions from "./browser-sessions"

/** Owns one authoritative Workspace and serializes its state transitions. */
export default class Workspace {
  private current: BrowserWorkspace
  private queue: Promise<void> = Promise.resolve()
  private closing: Promise<void> | null = null

  public constructor(
    public readonly identity: string,
    public readonly lifecycle: BrowserWorkspaceLifecycle,
    private readonly sessions: BrowserSessions,
    private readonly changed: (workspace: Workspace) => unknown
  ) {
    this.current = freezeWorkspace({
      workspace: identity,
      lifecycle,
      revision: 0,
      active: null,
      sessions: []
    })
  }

  public async snapshot() {
    this.ensureOpen()
    await this.queue
    this.ensureOpen()
    return this.current
  }

  public create(viewport: BrowserViewport) {
    return this.mutate(() => this.sessions.create(this.identity, viewport))
  }

  public closeSession(session: string) { return this.mutate(() => this.sessions.close(this.identity, session)) }
  public select(session: string) { return this.mutate(async () => this.sessions.select(this.identity, session)) }
  public capture(session: string) { return this.read(() => this.sessions.snapshot(this.identity, session)) }
  public navigate(session: string, url: string) { return this.mutate(() => this.sessions.navigate(this.identity, session, url)) }
  public back(session: string) { return this.mutate(() => this.sessions.back(this.identity, session)) }
  public forward(session: string) { return this.mutate(() => this.sessions.forward(this.identity, session)) }
  public reload(session: string) { return this.mutate(() => this.sessions.reload(this.identity, session)) }
  public resize(session: string, viewport: BrowserViewport) { return this.mutate(() => this.sessions.resize(this.identity, session, viewport)) }
  public click(session: string, x: number, y: number, button: "left" | "middle" | "right") {
    return this.mutate(() => this.sessions.click(this.identity, session, x, y, button))
  }
  public wheel(session: string, deltaX: number, deltaY: number) {
    this.ensureOpen()
    return this.sessions.wheel(this.identity, session, deltaX, deltaY)
  }
  public type(session: string, text: string) { return this.mutate(() => this.sessions.type(this.identity, session, text)) }
  public press(session: string, key: string) { return this.mutate(() => this.sessions.press(this.identity, session, key)) }
  public startFrames(session: string, event: string, listener: (frame: BrowserFrame) => unknown) {
    return this.read(() => this.sessions.startFrames(this.identity, session, event, listener))
  }
  public keepFrames(session: string, event: string) {
    this.ensureOpen()
    return this.sessions.keepFrames(this.identity, session, event)
  }
  public stopFrames(session: string, event: string) {
    this.ensureOpen()
    return this.sessions.stopFrames(this.identity, session, event)
  }

  public synchronize() {
    if (this.closing) return
    void this.schedule(() => this.refresh()).catch(() => undefined)
  }

  public close() {
    if (!this.closing) this.closing = this.finishClose()
    return this.closing
  }

  private async finishClose() {
    await this.queue
    await this.sessions.closeWorkspace(this.identity)
  }

  private mutate<Result>(operation: () => Promise<Result>) {
    return this.schedule(async () => {
      const result = await operation()
      await this.refresh()
      return result
    })
  }

  private read<Result>(operation: () => Promise<Result>) {
    return this.schedule(operation)
  }

  private schedule<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.ensureOpen()
    const task = this.queue.then(operation)
    this.queue = task.then(() => undefined, () => undefined)
    return task
  }

  private async refresh() {
    const state = await this.sessions.workspace(this.identity)
    if (sameWorkspaceState(this.current, state)) return

    this.current = freezeWorkspace({
      workspace: this.identity,
      lifecycle: this.lifecycle,
      revision: this.current.revision + 1,
      active: state.active,
      sessions: state.sessions
    })
    this.changed(this)
  }

  private ensureOpen() {
    if (this.closing) throw new Error("The browser workspace is closed")
  }
}

function sameWorkspaceState(
  current: BrowserWorkspace,
  state: Omit<BrowserWorkspace, "workspace" | "lifecycle" | "revision">
) {
  if (current.active !== state.active || current.sessions.length !== state.sessions.length) return false

  return current.sessions.every((session, index) => {
    const next = state.sessions[index]
    return next !== undefined
      && session.session === next.session
      && session.url === next.url
      && session.title === next.title
      && session.viewport.width === next.viewport.width
      && session.viewport.height === next.viewport.height
  })
}

function freezeWorkspace(workspace: BrowserWorkspace): BrowserWorkspace {
  return Object.freeze({
    ...workspace,
    sessions: Object.freeze(workspace.sessions.map(session => Object.freeze({
      ...session,
      viewport: Object.freeze({ ...session.viewport })
    })))
  })
}
