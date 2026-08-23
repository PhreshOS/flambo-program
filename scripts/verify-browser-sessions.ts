import assert from "node:assert/strict"
import Application, { type WorkspaceClient } from "@server/core/application"
import BrowserSessions from "@server/core/browser-sessions"
import type {
  BrowserEngine,
  BrowserPage,
  BrowserWorkspaceEngine,
  FrameListener,
  PageSnapshot
} from "@server/core/browser-engine"
import type { BrowserViewport } from "@server/core/browser"

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

class FakeWorkspace implements BrowserWorkspaceEngine {
  public readonly pages: FakePage[] = []
  public closed = false

  public async open(viewport: BrowserViewport) {
    const page = new FakePage(viewport)
    this.pages.push(page)
    return page
  }

  public async close() {
    this.closed = true
    for (const page of this.pages) await page.close()
  }
}

class FakeEngine implements BrowserEngine {
  public readonly workspaces: FakeWorkspace[] = []
  public closed = false

  public get pages() { return this.workspaces.flatMap(workspace => workspace.pages) }

  public async createWorkspace() {
    const workspace = new FakeWorkspace()
    this.workspaces.push(workspace)
    return workspace
  }

  public async close() { this.closed = true }
}

const engine = new FakeEngine()
const sessions = new BrowserSessions(engine, { total: 3, perWorkspace: 2 })
await sessions.createWorkspace("workspace:first")
await sessions.createWorkspace("workspace:second")
await sessions.createWorkspace("workspace:third")
const first = await sessions.create("workspace:first", { width: 800, height: 500 })
const second = await sessions.create("workspace:first", { width: 640, height: 400 })
await sessions.create("workspace:second", { width: 900, height: 600 })

assert.equal(first.url, "about:blank")
assert.equal(first.viewport.width, 800)
assert.notEqual(first.session, second.session)
assert.equal(sessions.metrics().sessions.active, 3)
assert.equal(sessions.metrics().sessions.peak, 3)
assert.equal(sessions.metrics().sessions.created, 3)
assert.deepEqual(sessions.metrics().capacity, { total: 3, perWorkspace: 2 })
assert.equal(sessions.metrics().sessions.opening, 0)
assert.equal(engine.workspaces.length, 3)
assert.equal(engine.workspaces[0]?.pages.length, 2)
assert.equal(engine.workspaces[1]?.pages.length, 1)
assert.throws(() => sessions.snapshot("workspace:second", first.session), /does not exist/)
await assert.rejects(sessions.create("workspace:third", { width: 800, height: 500 }), /total session limit/)

const initialWorkspace = await sessions.workspace("workspace:first")
assert.equal(initialWorkspace.sessions.length, 2)
assert.equal(initialWorkspace.active, second.session)
sessions.select("workspace:first", first.session)
assert.equal((await sessions.workspace("workspace:first")).active, first.session)

const wheels = [
  sessions.wheel("workspace:first", first.session, 0, 20),
  sessions.wheel("workspace:first", first.session, 5, 30),
  sessions.wheel("workspace:first", first.session, -5, 10)
]
await Promise.all(wheels)
assert.deepEqual(engine.pages[0]?.wheelDeltas, [[0, 60]])

await sessions.navigate("workspace:first", first.session, "https://example.com/")
const navigated = await sessions.snapshot("workspace:first", first.session)
assert.equal(navigated.url, "https://example.com/")
assert.equal(navigated.title, "Navigated")

let firstFrames = 0
let secondFrames = 0
await sessions.startFrames("workspace:first", first.session, "frame:first", () => { firstFrames += 1 })
await sessions.startFrames("workspace:first", first.session, "frame:second", () => { secondFrames += 1 })
assert.equal(firstFrames, 1)
assert.equal(secondFrames, 1)
await engine.pages[0]?.emitFrame()
assert.equal(firstFrames, 2)
assert.equal(secondFrames, 2)
await sessions.reload("workspace:first", first.session)
assert.equal(firstFrames, 3)
assert.equal(secondFrames, 3)
assert.equal(engine.pages[0]?.frameStarts, 1)
assert.equal(sessions.metrics().streams.active, 2)
assert.equal(sessions.metrics().streams.frames, 6)
await sessions.stopFrames("workspace:first", first.session, "frame:first")
assert.equal(sessions.metrics().streams.active, 1)
assert.equal(engine.pages[0]?.frameStops, 0)
await sessions.stopFrames("workspace:first", first.session, "frame:second")
assert.equal(sessions.metrics().streams.active, 0)
assert.equal(engine.pages[0]?.frameStops, 1)

let releaseFrame!: () => void
const frameGate = new Promise<void>(resolve => { releaseFrame = resolve })
const deliveredSequences: number[] = []
await sessions.startFrames("workspace:first", first.session, "frame:slow", async frame => {
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
await sessions.stopFrames("workspace:first", first.session, "frame:slow")

await sessions.startFrames("workspace:first", second.session, "frame:closing", () => undefined)
await sessions.close("workspace:first", second.session)
assert.equal(engine.pages[1]?.closed, true)
assert.equal(sessions.metrics().sessions.active, 2)
assert.equal(sessions.metrics().streams.active, 0)
await sessions.stopFrames("workspace:first", second.session, "frame:closing")

await sessions.closeWorkspace("workspace:first")
assert.equal(sessions.metrics().sessions.active, 1)

await sessions.dispose()
assert.equal(engine.closed, true)
assert.equal(engine.pages.every(page => page.closed), true)
assert(sessions.metrics().operations.completed > 0)
assert.equal(sessions.metrics().operations.failed, 0)

const capacityEngine = new FakeEngine()
const capacity = new BrowserSessions(capacityEngine, { total: 1, perWorkspace: 1 })
await capacity.createWorkspace("client:a")
await capacity.createWorkspace("client:b")
const attempts = await Promise.allSettled([
  capacity.create("client:a", { width: 800, height: 500 }),
  capacity.create("client:b", { width: 800, height: 500 })
])

assert.equal(attempts.filter(result => result.status === "fulfilled").length, 1)
assert.equal(attempts.filter(result => result.status === "rejected").length, 1)
assert.equal(capacity.metrics().sessions.active, 1)
await capacity.dispose()

const leaseEngine = new FakeEngine()
const leased = new BrowserSessions(leaseEngine, { total: 1, perWorkspace: 1 }, 10)
await leased.createWorkspace("client:lease")
const leasedSession = await leased.create("client:lease", { width: 800, height: 500 })
await leased.startFrames("client:lease", leasedSession.session, "frame:lease", () => undefined)
assert.equal(leased.metrics().streams.active, 1)
await new Promise(resolve => setTimeout(resolve, 25))
assert.equal(leased.metrics().streams.active, 0)
assert.equal(leaseEngine.pages[0]?.frameStops, 1)
assert.equal((await leased.workspace("client:lease")).sessions.length, 1)
await leased.dispose()

const applicationEngine = new FakeEngine()
let clientStopped!: (client: string) => unknown
let launchedWorkspace = ""
const exitedClients = new Set<string>()
const clientExits = new Map<string, number>()
const client = (identity: string, assignment?: string): WorkspaceClient => ({
  identity,
  assignment,
  exited: async () => exitedClients.has(identity),
  async exit() {
    exitedClients.add(identity)
    clientExits.set(identity, (clientExits.get(identity) ?? 0) + 1)
  }
})
let application!: Application
application = new Application(applicationEngine, {
  limits: { total: 4, perWorkspace: 2 },
  clients: {
    async create(workspace) {
      launchedWorkspace = workspace
      const launched = client("client:launched", workspace)
      queueMicrotask(() => void application.attachClient(launched, workspace))
      return launched
    },
    subscribe(listener) {
      clientStopped = listener
      return () => undefined
    }
  },
  attachmentMilliseconds: 1_000
})
const attached = await application.attachClient(client("client:one"))
const sameAttached = await application.attachClient(client("client:one"))
const isolated = await application.attachClient(client("client:two"))
const explicit = await application.createWorkspace(false)
const launched = await application.createWorkspace(true)
let workspaceChanges = 0
application.subscribeWorkspaces(() => { workspaceChanges += 1 })

assert.equal(attached, sameAttached)
assert.notEqual(attached.identity, isolated.identity)
assert.equal(launched.identity, launchedWorkspace)
assert.equal((await attached.snapshot()).lifecycle, "client")
assert.equal((await launched.snapshot()).lifecycle, "client")
assert.equal((await explicit.snapshot()).lifecycle, "explicit")
assert.equal((await attached.snapshot()).sessions.length, 0)
assert.equal((await isolated.snapshot()).sessions.length, 0)
assert.equal((await explicit.snapshot()).sessions.length, 0)
assert.equal((await launched.snapshot()).sessions.length, 0)

const attachedSession = await attached.create({ width: 800, height: 500 })
assert.equal(workspaceChanges, 1)
assert.equal((await attached.snapshot()).revision, 1)
await attached.startFrames(attachedSession.session, "frame:workspace", () => undefined)
const attachedPage = applicationEngine.workspaces[0]?.pages[0]
assert(attachedPage)
attachedPage.url = "https://human.example/"
attachedPage.title = "Human navigation"
await attachedPage.emitFrame()
assert.equal((await attached.snapshot()).revision, 2)
assert.equal((await attached.snapshot()).sessions[0]?.url, "https://human.example/")
assert.equal(workspaceChanges, 2)
await attached.stopFrames(attachedSession.session, "frame:workspace")
await explicit.create({ width: 800, height: 500 })
assert.equal(workspaceChanges, 3)
assert.equal((await attached.snapshot()).sessions.length, 1)
assert.equal((await isolated.snapshot()).sessions.length, 0)
await assert.rejects(isolated.capture(attachedSession.session), /does not exist in this workspace/)

await clientStopped("client:one")
assert.throws(() => application.workspace(attached.identity), /workspace does not exist/)
assert.equal(application.metrics().sessions.active, 1)
assert.equal((await explicit.snapshot()).sessions.length, 1)

await application.closeWorkspace(isolated.identity)
assert.equal(clientExits.get("client:two"), 1)
assert.throws(() => application.workspace(isolated.identity), /workspace does not exist/)

await application.closeWorkspace(launched.identity)
assert.equal(clientExits.get("client:launched"), 1)

await application.closeWorkspace(explicit.identity)
assert.equal(application.metrics().sessions.active, 0)
await application.dispose()
assert.equal(applicationEngine.workspaces.every(workspace => workspace.closed), true)

const abandonedEngine = new FakeEngine()
const abandoned = new Application(abandonedEngine, {
  clients: {
    async create(workspace) {
      return {
        identity: "client:abandoned",
        assignment: workspace,
        exited: async () => true,
        exit: async () => undefined
      }
    },
    subscribe() { return () => undefined }
  }
})

await assert.rejects(abandoned.createWorkspace(true), /exited before attaching/)
assert.equal(abandonedEngine.workspaces.length, 1)
assert.equal(abandonedEngine.workspaces[0]?.closed, true)
await abandoned.dispose()
