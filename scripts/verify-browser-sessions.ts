import assert from "node:assert/strict"
import BrowserSessions from "@server/core/browser-sessions"
import type { BrowserEngine, BrowserPage, FrameListener, PageSnapshot } from "@libs/browser-engine"
import type { BrowserViewport } from "@/source/contracts"

class FakePage implements BrowserPage {
  public closed = false
  public url = "about:blank"
  public title = ""
  public frame: FrameListener | null = null
  public frameSequence = 0
  public frameStarts = 0
  public frameStops = 0
  public wheelDeltas: Array<readonly [number, number]> = []

  public constructor(public viewport: BrowserViewport) {}

  public async state() {
    return { url: this.url, title: this.title, viewport: this.viewport }
  }

  public async snapshot(): Promise<PageSnapshot> {
    return { url: this.url, title: this.title, image: "AA==", viewport: this.viewport, capturedAt: Date.now() }
  }

  public async currentFrame() {
    return { sequence: this.frameSequence += 1, ...await this.snapshot() }
  }

  public async navigate(url: string) { this.url = url; this.title = "Navigated" }
  public async back() {}
  public async forward() {}
  public async reload() {}
  public async resize(viewport: BrowserViewport) { this.viewport = viewport }
  public async click() {}
  public async wheel(deltaX: number, deltaY: number) { this.wheelDeltas.push([deltaX, deltaY]) }
  public async type() {}
  public async press() {}
  public async startFrames(listener: FrameListener) {
    this.frame = listener
    this.frameStarts += 1
  }
  public async stopFrames() { this.frame = null; this.frameStops += 1 }
  public async close() { this.closed = true }

  public async emitFrame() {
    this.frame?.(await this.currentFrame())
  }
}

class FakeEngine implements BrowserEngine {
  public readonly pages: FakePage[] = []
  public closed = false

  public async open(viewport: BrowserViewport) {
    const page = new FakePage(viewport)
    this.pages.push(page)
    return page
  }

  public async close() { this.closed = true }
}

const engine = new FakeEngine()
const sessions = new BrowserSessions(engine, { total: 3, perOwner: 2 })
const first = await sessions.create("client:first", { width: 800, height: 500 })
const second = await sessions.create("client:first", { width: 640, height: 400 })
await sessions.create("server:second", { width: 900, height: 600 })

assert.equal(first.url, "about:blank")
assert.equal(first.viewport.width, 800)
assert.notEqual(first.session, second.session)
assert.equal(sessions.metrics().sessions.active, 3)
assert.equal(sessions.metrics().sessions.peak, 3)
assert.equal(sessions.metrics().sessions.created, 3)
assert.deepEqual(sessions.metrics().capacity, { total: 3, perOwner: 2 })
assert.equal(sessions.metrics().sessions.opening, 0)
assert.throws(() => sessions.snapshot("server:second", first.session), /does not exist/)
await assert.rejects(sessions.create("server:third", { width: 800, height: 500 }), /total session limit/)

const initialWorkspace = await sessions.workspace("client:first")
assert.equal(initialWorkspace.sessions.length, 2)
assert.equal(initialWorkspace.active, second.session)
sessions.select("client:first", first.session)
assert.equal((await sessions.workspace("client:first")).active, first.session)

const wheels = [
  sessions.wheel("client:first", first.session, 0, 20),
  sessions.wheel("client:first", first.session, 5, 30),
  sessions.wheel("client:first", first.session, -5, 10)
]
await Promise.all(wheels)
assert.deepEqual(engine.pages[0]?.wheelDeltas, [[0, 60]])

await sessions.navigate("client:first", first.session, "https://example.com/")
const navigated = await sessions.snapshot("client:first", first.session)
assert.equal(navigated.url, "https://example.com/")
assert.equal(navigated.title, "Navigated")

let firstFrames = 0
let secondFrames = 0
await sessions.startFrames("client:first", first.session, "frame:first", () => { firstFrames += 1 })
await sessions.startFrames("client:first", first.session, "frame:second", () => { secondFrames += 1 })
assert.equal(firstFrames, 1)
assert.equal(secondFrames, 1)
await engine.pages[0]?.emitFrame()
assert.equal(firstFrames, 2)
assert.equal(secondFrames, 2)
await sessions.reload("client:first", first.session)
assert.equal(firstFrames, 3)
assert.equal(secondFrames, 3)
assert.equal(engine.pages[0]?.frameStarts, 1)
assert.equal(sessions.metrics().streams.active, 2)
assert.equal(sessions.metrics().streams.frames, 6)
await sessions.stopFrames("client:first", first.session, "frame:first")
assert.equal(sessions.metrics().streams.active, 1)
assert.equal(engine.pages[0]?.frameStops, 0)
await sessions.stopFrames("client:first", first.session, "frame:second")
assert.equal(sessions.metrics().streams.active, 0)
assert.equal(engine.pages[0]?.frameStops, 1)

let releaseFrame!: () => void
const frameGate = new Promise<void>(resolve => { releaseFrame = resolve })
const deliveredSequences: number[] = []
await sessions.startFrames("client:first", first.session, "frame:slow", async frame => {
  deliveredSequences.push(frame.sequence)
  if (deliveredSequences.length === 1) await frameGate
})
await engine.pages[0]?.emitFrame()
await engine.pages[0]?.emitFrame()
await engine.pages[0]?.emitFrame()
assert.deepEqual(deliveredSequences, [5])
releaseFrame()
await new Promise(resolve => setTimeout(resolve, 0))
assert.deepEqual(deliveredSequences, [5, 8])
await sessions.stopFrames("client:first", first.session, "frame:slow")

await sessions.close("client:first", second.session)
assert.equal(engine.pages[1]?.closed, true)
assert.equal(sessions.metrics().sessions.active, 2)

await sessions.closeOwner("client:first")
assert.equal(sessions.metrics().sessions.active, 1)

await sessions.dispose()
assert.equal(engine.closed, true)
assert.equal(engine.pages.every(page => page.closed), true)
assert(sessions.metrics().operations.completed > 0)
assert.equal(sessions.metrics().operations.failed, 0)

const capacityEngine = new FakeEngine()
const capacity = new BrowserSessions(capacityEngine, { total: 1, perOwner: 1 })
const attempts = await Promise.allSettled([
  capacity.create("client:a", { width: 800, height: 500 }),
  capacity.create("client:b", { width: 800, height: 500 })
])

assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1)
assert.equal(attempts.filter(result => result.status === "rejected").length, 1)
assert.equal(capacity.metrics().sessions.active, 1)
await capacity.dispose()

const leaseEngine = new FakeEngine()
const leased = new BrowserSessions(leaseEngine, { total: 1, perOwner: 1 }, 10)
const leasedSession = await leased.create("client:lease", { width: 800, height: 500 })
await leased.startFrames("client:lease", leasedSession.session, "frame:lease", () => undefined)
assert.equal(leased.metrics().streams.active, 1)
await new Promise(resolve => setTimeout(resolve, 25))
assert.equal(leased.metrics().streams.active, 0)
assert.equal(leaseEngine.pages[0]?.frameStops, 1)
assert.equal((await leased.workspace("client:lease")).sessions.length, 1)
await leased.dispose()
