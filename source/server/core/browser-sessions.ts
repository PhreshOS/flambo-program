import { randomUUID } from "node:crypto"
import type { BrowserEngine, BrowserPage, BrowserWorkspaceEngine } from "./browser-engine"
import type {
  BrowserFrame,
  BrowserMetrics,
  BrowserSession,
  BrowserSnapshot,
  BrowserViewport,
  BrowserWorkspace
} from "./browser"

export type BrowserLimits = Readonly<{
  total: number
  perWorkspace: number
}>

type Session = {
  workspace: string
  page: BrowserPage
  state: BrowserSession
  queue: Promise<void>
  streams: Map<string, Stream>
  wheel: {
    deltaX: number
    deltaY: number
    task: Promise<void> | null
  }
}

type Stream = {
  listener: (frame: BrowserFrame) => unknown
  pending: BrowserFrame | null
  sending: boolean
  timeout: ReturnType<typeof setTimeout> | null
}

const defaultLimits: BrowserLimits = { total: 64, perWorkspace: 16 }
const frameLeaseMilliseconds = 15_000

/** Owns isolated browser sessions, ordered operations, limits, and capacity metrics. */
export default class BrowserSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly workspaceEngines = new Map<string, BrowserWorkspaceEngine>()
  private readonly workspaceSessions = new Map<string, Set<string>>()
  private readonly activeWorkspaces = new Map<string, string>()
  private readonly openingWorkspaces = new Map<string, number>()
  private opening = 0
  private created = 0
  private sessionPeak = 0
  private streamActive = 0
  private streamFrames = 0
  private streamBytes = 0
  private operationActive = 0
  private operationCompleted = 0
  private operationFailed = 0
  private operationPeak = 0
  private operationMilliseconds = 0
  private operationMaximumMilliseconds = 0

  public constructor(
    private readonly engine: BrowserEngine,
    private readonly limits: BrowserLimits = defaultLimits,
    private readonly leaseMilliseconds = frameLeaseMilliseconds,
    private readonly changed: (workspace: string) => unknown = () => undefined
  ) {
    if (!Number.isInteger(limits.total) || limits.total < 1) throw new Error("The total browser session limit must be a positive integer")
    if (!Number.isInteger(limits.perWorkspace) || limits.perWorkspace < 1) throw new Error("The per-workspace browser session limit must be a positive integer")
    if (!Number.isInteger(leaseMilliseconds) || leaseMilliseconds < 1) throw new Error("The browser frame lease must be a positive integer")
  }

  public async createWorkspace(workspace: string) {
    if (this.workspaceEngines.has(workspace)) throw new Error("The browser workspace already exists")

    const engine = await this.measure(() => this.engine.createWorkspace())

    if (this.workspaceEngines.has(workspace)) {
      await engine.close().catch(() => undefined)
      throw new Error("The browser workspace already exists")
    }

    this.workspaceEngines.set(workspace, engine)
  }

  public async create(workspace: string, viewport: BrowserViewport): Promise<BrowserSnapshot> {
    this.reserve(workspace)

    const id = randomUUID()
    let page: BrowserPage

    try {
      page = await this.measure(() => this.workspaceEngine(workspace).open(viewport))
    } finally {
      this.release(workspace)
    }

    const session: Session = {
      workspace,
      page,
      state: { session: id, url: "about:blank", title: "", viewport },
      queue: Promise.resolve(),
      streams: new Map(),
      wheel: { deltaX: 0, deltaY: 0, task: null }
    }

    this.sessions.set(id, session)
    this.workspaceSessions.get(workspace)?.add(id) ?? this.workspaceSessions.set(workspace, new Set([id]))
    this.activeWorkspaces.set(workspace, id)
    this.created += 1
    this.sessionPeak = Math.max(this.sessionPeak, this.sessions.size)

    try {
      const snapshot = await this.snapshot(workspace, id)
      return snapshot
    } catch (error) {
      this.detach(workspace, id)
      await page.close().catch(() => undefined)
      throw error
    }
  }

  public snapshot(workspace: string, session: string) {
    return this.run(workspace, session, async page => {
      const snapshot = await page.snapshot()
      this.updateState(session, snapshot)
      return { session, ...snapshot }
    })
  }

  public workspace(workspace: string): Omit<BrowserWorkspace, "workspace" | "lifecycle" | "revision"> {
    this.workspaceEngine(workspace)
    const ids = [...this.workspaceSessions.get(workspace) ?? []]
    const sessions = ids.map(id => this.inWorkspace(workspace, id).state)
    const selected = this.activeWorkspaces.get(workspace)

    return {
      active: selected && ids.includes(selected) ? selected : ids.at(-1) ?? null,
      sessions
    }
  }

  public select(workspace: string, id: string) {
    this.inWorkspace(workspace, id)
    this.activeWorkspaces.set(workspace, id)
  }

  public navigate(workspace: string, session: string, url: string) {
    return this.actAndFrame(workspace, session, page => page.navigate(url))
  }

  public back(workspace: string, session: string) { return this.actAndFrame(workspace, session, page => page.back()) }
  public forward(workspace: string, session: string) { return this.actAndFrame(workspace, session, page => page.forward()) }
  public reload(workspace: string, session: string) { return this.actAndFrame(workspace, session, page => page.reload()) }

  public resize(workspace: string, session: string, viewport: BrowserViewport) {
    return this.actAndState(workspace, session, page => page.resize(viewport))
  }

  public click(workspace: string, session: string, x: number, y: number, button: "left" | "middle" | "right") {
    return this.actAndState(workspace, session, page => page.click(x, y, button))
  }

  public wheel(workspace: string, session: string, deltaX: number, deltaY: number) {
    const current = this.inWorkspace(workspace, session)
    current.wheel.deltaX += deltaX
    current.wheel.deltaY += deltaY

    if (current.wheel.task) return current.wheel.task

    const task = this.run(workspace, session, page => this.flushWheel(current, page))
    current.wheel.task = task
    return task
  }

  public type(workspace: string, session: string, text: string) {
    return this.actAndState(workspace, session, page => page.type(text))
  }

  public press(workspace: string, session: string, key: string) {
    return this.actAndState(workspace, session, page => page.press(key))
  }

  public startFrames(workspace: string, id: string, event: string, listener: (frame: BrowserFrame) => unknown) {
    const session = this.inWorkspace(workspace, id)

    return this.run(workspace, id, async page => {
      const existing = session.streams.get(event)

      if (existing) {
        existing.listener = listener
        this.renewStream(id, event, existing)
        const frame = { session: id, ...await page.currentFrame() }
        this.updateState(id, frame)
        this.deliverFrame(id, event, existing, frame)
        return this.leaseMilliseconds
      }

      const stream: Stream = {
        listener,
        pending: null,
        sending: false,
        timeout: null
      }
      session.streams.set(event, stream)
      this.streamActive += 1
      this.renewStream(id, event, stream)

      try {
        if (session.streams.size === 1) await page.startFrames(frame => this.publishFrame(id, frame))
        const frame = { session: id, ...await page.currentFrame() }
        this.updateState(id, frame)
        this.deliverFrame(id, event, stream, frame)
      } catch (error) {
        this.dropStream(session, event)
        throw error
      }

      return this.leaseMilliseconds
    })
  }

  public keepFrames(workspace: string, id: string, event: string) {
    const session = this.sessions.get(id)
    if (!session || session.workspace !== workspace) return
    const stream = session.streams.get(event)
    if (stream) this.renewStream(id, event, stream)
  }

  public stopFrames(workspace: string, id: string, event: string) {
    const session = this.sessions.get(id)

    // Stream cleanup may arrive after Session cleanup. Both operations are
    // idempotent, so a late stop has already reached its intended state.
    if (!session || session.workspace !== workspace) return Promise.resolve()
    if (!this.dropStream(session, event) || session.streams.size > 0) return Promise.resolve()

    return this.run(workspace, id, async page => {
      await page.stopFrames()
    })
  }

  public async close(workspace: string, id: string) {
    const session = this.inWorkspace(workspace, id)
    this.detach(workspace, id)
    await session.queue
    this.dropStreams(session)
    await this.measure(() => session.page.close())
  }

  public async closeWorkspace(workspace: string) {
    const engine = this.workspaceEngine(workspace)
    this.workspaceEngines.delete(workspace)
    const ids = [...this.workspaceSessions.get(workspace) ?? []]

    try {
      await Promise.all(ids.map(id => this.close(workspace, id)))
      this.activeWorkspaces.delete(workspace)
    } finally {
      await this.measure(() => engine.close())
    }
  }

  public async dispose() {
    const sessions = [...this.sessions.values()]
    const workspaces = [...this.workspaceEngines.values()]
    this.sessions.clear()
    this.workspaceEngines.clear()
    this.workspaceSessions.clear()
    this.activeWorkspaces.clear()
    await Promise.all(sessions.map(async session => {
      await session.queue
      this.dropStreams(session)
      await session.page.close().catch(() => undefined)
    }))
    await Promise.all(workspaces.map(workspace => workspace.close().catch(() => undefined)))
    this.streamActive = 0
    await this.engine.close()
  }

  public metrics(): BrowserMetrics {
    return {
      capacity: this.limits,
      sessions: {
        opening: this.opening,
        active: this.sessions.size,
        created: this.created,
        peak: this.sessionPeak
      },
      streams: {
        active: this.streamActive,
        frames: this.streamFrames,
        bytes: this.streamBytes
      },
      operations: {
        active: this.operationActive,
        completed: this.operationCompleted,
        failed: this.operationFailed,
        peak: this.operationPeak,
        averageMilliseconds: this.operationCompleted + this.operationFailed === 0
          ? 0
          : this.operationMilliseconds / (this.operationCompleted + this.operationFailed),
        maximumMilliseconds: this.operationMaximumMilliseconds
      }
    }
  }

  private publishFrame(id: string, frame: Omit<BrowserFrame, "session">) {
    const session = this.sessions.get(id)
    if (!session) return

    const message = { session: id, ...frame }
    this.updateState(id, frame)
    const bytes = encodedBytes(frame.image)

    for (const [event, stream] of session.streams) this.deliverFrame(id, event, stream, message, bytes)
  }

  private deliverFrame(id: string, event: string, stream: Stream, frame: BrowserFrame, bytes = encodedBytes(frame.image)) {
    const session = this.sessions.get(id)
    if (!session || session.streams.get(event) !== stream) return

    if (stream.sending) {
      stream.pending = frame
      return
    }

    stream.sending = true
    this.streamFrames += 1
    this.streamBytes += bytes

    Promise.resolve(stream.listener(frame)).catch(() => undefined).finally(() => {
      stream.sending = false

      const current = this.sessions.get(id)
      if (!current || current.streams.get(event) !== stream) {
        stream.pending = null
        return
      }

      const pending = stream.pending
      stream.pending = null
      if (pending) this.deliverFrame(id, event, stream, pending)
    })
  }

  private renewStream(id: string, event: string, stream: Stream) {
    if (stream.timeout) clearTimeout(stream.timeout)
    stream.timeout = setTimeout(() => void this.expireStream(id, event), this.leaseMilliseconds)
    stream.timeout.unref()
  }

  private async expireStream(id: string, event: string) {
    const session = this.sessions.get(id)
    if (!session || !this.dropStream(session, event) || session.streams.size > 0) return

    const task = session.queue.then(() => this.measure(() => session.page.stopFrames()))
    session.queue = task.then(() => undefined, () => undefined)
    await task.catch(() => undefined)
  }

  private dropStream(session: Session, event: string) {
    const stream = session.streams.get(event)
    if (!stream) return false

    if (stream.timeout) clearTimeout(stream.timeout)
    stream.pending = null
    session.streams.delete(event)
    this.streamActive -= 1
    return true
  }

  private dropStreams(session: Session) {
    for (const stream of session.streams.values()) {
      if (stream.timeout) clearTimeout(stream.timeout)
    }
    this.streamActive -= session.streams.size
    session.streams.clear()
  }

  private actAndFrame(workspace: string, id: string, operation: (page: BrowserPage) => Promise<void>) {
    const session = this.inWorkspace(workspace, id)

    return this.run(workspace, id, async page => {
      await operation(page)
      if (session.streams.size > 0) this.publishFrame(id, await page.currentFrame())
      else this.updateState(id, await page.state())
    })
  }

  private actAndState(workspace: string, id: string, operation: (page: BrowserPage) => Promise<void>) {
    return this.run(workspace, id, async page => {
      await operation(page)
      this.updateState(id, await page.state())
    })
  }

  private flushWheel(session: Session, page: BrowserPage) {
    const deltaX = session.wheel.deltaX
    const deltaY = session.wheel.deltaY
    session.wheel.deltaX = 0
    session.wheel.deltaY = 0
    session.wheel.task = null
    return page.wheel(deltaX, deltaY)
  }

  private run<Result>(workspace: string, id: string, operation: (page: BrowserPage) => Promise<Result>): Promise<Result> {
    const session = this.inWorkspace(workspace, id)
    const task = session.queue.then(() => this.measure(() => operation(session.page)))

    session.queue = task.then(() => undefined, () => undefined)

    return task
  }

  private inWorkspace(workspace: string, id: string) {
    const session = this.sessions.get(id)

    if (!session || session.workspace !== workspace) throw new Error("The browser session does not exist in this workspace")

    return session
  }

  private workspaceEngine(workspace: string) {
    const engine = this.workspaceEngines.get(workspace)
    if (!engine) throw new Error("The browser workspace does not exist")
    return engine
  }

  private updateState(id: string, state: Omit<BrowserSession, "session">) {
    const session = this.sessions.get(id)
    if (!session) return

    const next = { session: id, url: state.url, title: state.title, viewport: state.viewport }
    if (sameState(session.state, next)) return

    session.state = next
    this.changed(session.workspace)
  }

  private reserve(workspace: string) {
    this.workspaceEngine(workspace)
    if (this.sessions.size + this.opening >= this.limits.total) {
      throw new Error("The browser reached its total session limit")
    }

    const used = (this.workspaceSessions.get(workspace)?.size ?? 0) + (this.openingWorkspaces.get(workspace) ?? 0)

    if (used >= this.limits.perWorkspace) throw new Error("The browser reached this workspace's session limit")

    this.opening += 1
    this.openingWorkspaces.set(workspace, (this.openingWorkspaces.get(workspace) ?? 0) + 1)
  }

  private release(workspace: string) {
    const used = this.openingWorkspaces.get(workspace)

    this.opening -= 1
    if (used === 1) this.openingWorkspaces.delete(workspace)
    else if (used) this.openingWorkspaces.set(workspace, used - 1)
  }

  private detach(workspace: string, id: string) {
    this.sessions.delete(id)

    const sessions = this.workspaceSessions.get(workspace)
    sessions?.delete(id)

    if (this.activeWorkspaces.get(workspace) === id) {
      const next = sessions ? [...sessions].at(-1) : undefined
      if (next) this.activeWorkspaces.set(workspace, next)
      else this.activeWorkspaces.delete(workspace)
    }

    if (sessions?.size === 0) this.workspaceSessions.delete(workspace)
  }

  private async measure<Result>(operation: () => Promise<Result>) {
    const started = performance.now()

    this.operationActive += 1
    this.operationPeak = Math.max(this.operationPeak, this.operationActive)

    try {
      const result = await operation()
      this.operationCompleted += 1
      return result
    } catch (error) {
      this.operationFailed += 1
      throw error
    } finally {
      const elapsed = performance.now() - started
      this.operationActive -= 1
      this.operationMilliseconds += elapsed
      this.operationMaximumMilliseconds = Math.max(this.operationMaximumMilliseconds, elapsed)
    }
  }
}

function encodedBytes(value: string) {
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0
  return Math.floor(value.length * 3 / 4) - padding
}

function sameState(left: BrowserSession, right: BrowserSession) {
  return left.url === right.url
    && left.title === right.title
    && left.viewport.width === right.viewport.width
    && left.viewport.height === right.viewport.height
}
