import { randomUUID } from "node:crypto"
import type { BrowserEngine, BrowserPage } from "@libs/browser-engine"
import type {
  BrowserFrame,
  BrowserMetrics,
  BrowserSnapshot,
  BrowserViewport,
  BrowserWorkspace
} from "@/source/contracts"

export type BrowserLimits = Readonly<{
  total: number
  perOwner: number
}>

type Session = {
  owner: string
  page: BrowserPage
  queue: Promise<void>
  streams: Map<string, Stream>
}

type Stream = {
  listener: (frame: BrowserFrame) => void
  timeout: ReturnType<typeof setTimeout> | null
}

const defaultLimits: BrowserLimits = { total: 64, perOwner: 16 }
const frameLeaseMilliseconds = 15_000

/** Owns isolated browser sessions, ordered operations, limits, and capacity metrics. */
export default class BrowserSessions {
  private readonly sessions = new Map<string, Session>()
  private readonly ownerSessions = new Map<string, Set<string>>()
  private readonly activeOwners = new Map<string, string>()
  private readonly openingOwners = new Map<string, number>()
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
    private readonly leaseMilliseconds = frameLeaseMilliseconds
  ) {
    if (!Number.isInteger(limits.total) || limits.total < 1) throw new Error("The total browser session limit must be a positive integer")
    if (!Number.isInteger(limits.perOwner) || limits.perOwner < 1) throw new Error("The per-owner browser session limit must be a positive integer")
    if (!Number.isInteger(leaseMilliseconds) || leaseMilliseconds < 1) throw new Error("The browser frame lease must be a positive integer")
  }

  public async create(owner: string, viewport: BrowserViewport): Promise<BrowserSnapshot> {
    this.reserve(owner)

    const id = randomUUID()
    let page: BrowserPage

    try {
      page = await this.measure(() => this.engine.open(viewport))
    } finally {
      this.release(owner)
    }

    const session: Session = { owner, page, queue: Promise.resolve(), streams: new Map() }

    this.sessions.set(id, session)
    this.ownerSessions.get(owner)?.add(id) ?? this.ownerSessions.set(owner, new Set([id]))
    this.activeOwners.set(owner, id)
    this.created += 1
    this.sessionPeak = Math.max(this.sessionPeak, this.sessions.size)

    try {
      return await this.snapshot(owner, id)
    } catch (error) {
      this.detach(owner, id)
      await page.close().catch(() => undefined)
      throw error
    }
  }

  public snapshot(owner: string, session: string) {
    return this.run(owner, session, page => page.snapshot()).then(snapshot => ({ session, ...snapshot }))
  }

  public async workspace(owner: string): Promise<BrowserWorkspace> {
    const ids = [...this.ownerSessions.get(owner) ?? []]
    const sessions = await Promise.all(ids.map(id => {
      return this.run(owner, id, page => page.state()).then(state => ({ session: id, ...state }))
    }))
    const selected = this.activeOwners.get(owner)

    return {
      active: selected && ids.includes(selected) ? selected : ids.at(-1) ?? null,
      sessions
    }
  }

  public select(owner: string, id: string) {
    this.owned(owner, id)
    this.activeOwners.set(owner, id)
  }

  public navigate(owner: string, session: string, url: string) {
    return this.act(owner, session, page => page.navigate(url))
  }

  public back(owner: string, session: string) { return this.act(owner, session, page => page.back()) }
  public forward(owner: string, session: string) { return this.act(owner, session, page => page.forward()) }
  public reload(owner: string, session: string) { return this.act(owner, session, page => page.reload()) }

  public resize(owner: string, session: string, viewport: BrowserViewport) {
    return this.act(owner, session, page => page.resize(viewport))
  }

  public click(owner: string, session: string, x: number, y: number, button: "left" | "middle" | "right") {
    return this.act(owner, session, page => page.click(x, y, button))
  }

  public wheel(owner: string, session: string, deltaX: number, deltaY: number) {
    return this.act(owner, session, page => page.wheel(deltaX, deltaY))
  }

  public type(owner: string, session: string, text: string) {
    return this.act(owner, session, page => page.type(text))
  }

  public press(owner: string, session: string, key: string) {
    return this.act(owner, session, page => page.press(key))
  }

  public startFrames(owner: string, id: string, event: string, listener: (frame: BrowserFrame) => void) {
    const session = this.owned(owner, id)

    return this.run(owner, id, async page => {
      const existing = session.streams.get(event)

      if (existing) {
        existing.listener = listener
        this.renewStream(id, event, existing)
        return this.leaseMilliseconds
      }

      const stream: Stream = {
        listener,
        timeout: null
      }
      session.streams.set(event, stream)
      this.streamActive += 1
      this.renewStream(id, event, stream)

      if (session.streams.size > 1) return this.leaseMilliseconds

      try {
        await page.startFrames(frame => this.publishFrame(id, frame))
      } catch (error) {
        this.dropStream(session, event)
        throw error
      }

      return this.leaseMilliseconds
    })
  }

  public keepFrames(owner: string, id: string, event: string) {
    const session = this.owned(owner, id)
    const stream = session.streams.get(event)
    if (stream) this.renewStream(id, event, stream)
  }

  public stopFrames(owner: string, id: string, event: string) {
    const session = this.owned(owner, id)
    if (!this.dropStream(session, event) || session.streams.size > 0) return Promise.resolve()

    return this.run(owner, id, async page => {
      await page.stopFrames()
    })
  }

  public async close(owner: string, id: string) {
    const session = this.owned(owner, id)
    this.detach(owner, id)
    await session.queue
    this.dropStreams(session)
    await this.measure(() => session.page.close())
  }

  public async closeOwner(owner: string) {
    const ids = [...this.ownerSessions.get(owner) ?? []]
    await Promise.all(ids.map(id => this.close(owner, id)))
    this.activeOwners.delete(owner)
  }

  public async dispose() {
    const sessions = [...this.sessions.values()]
    this.sessions.clear()
    this.ownerSessions.clear()
    this.activeOwners.clear()
    await Promise.all(sessions.map(async session => {
      await session.queue
      this.dropStreams(session)
      await session.page.close().catch(() => undefined)
    }))
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
    const bytes = encodedBytes(frame.image)

    for (const stream of session.streams.values()) {
      this.streamFrames += 1
      this.streamBytes += bytes
      stream.listener(message)
    }
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

  private act(owner: string, session: string, operation: (page: BrowserPage) => Promise<void>) {
    return this.run(owner, session, operation)
  }

  private run<Result>(owner: string, id: string, operation: (page: BrowserPage) => Promise<Result>): Promise<Result> {
    const session = this.owned(owner, id)
    const task = session.queue.then(() => this.measure(() => operation(session.page)))

    session.queue = task.then(() => undefined, () => undefined)

    return task
  }

  private owned(owner: string, id: string) {
    const session = this.sessions.get(id)

    if (!session || session.owner !== owner) throw new Error("The browser session does not exist")

    return session
  }

  private reserve(owner: string) {
    if (this.sessions.size + this.opening >= this.limits.total) {
      throw new Error("The browser reached its total session limit")
    }

    const owned = (this.ownerSessions.get(owner)?.size ?? 0) + (this.openingOwners.get(owner) ?? 0)

    if (owned >= this.limits.perOwner) throw new Error("The browser reached this consumer's session limit")

    this.opening += 1
    this.openingOwners.set(owner, (this.openingOwners.get(owner) ?? 0) + 1)
  }

  private release(owner: string) {
    const owned = this.openingOwners.get(owner)

    this.opening -= 1
    if (owned === 1) this.openingOwners.delete(owner)
    else if (owned) this.openingOwners.set(owner, owned - 1)
  }

  private detach(owner: string, id: string) {
    this.sessions.delete(id)

    const owned = this.ownerSessions.get(owner)
    owned?.delete(id)

    if (this.activeOwners.get(owner) === id) {
      const next = owned ? [...owned].at(-1) : undefined
      if (next) this.activeOwners.set(owner, next)
      else this.activeOwners.delete(owner)
    }

    if (owned?.size === 0) this.ownerSessions.delete(owner)
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
