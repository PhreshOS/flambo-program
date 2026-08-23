import assert from "node:assert/strict"
import Workspace, { type WorkspaceBoundary } from "@client/core/workspace"
import type { BrowserFrame, BrowserSnapshot, BrowserWorkspace } from "@server/core/browser"

const questions: Array<Readonly<{ event: string, payload: unknown }>> = []
const publications: Array<Readonly<{ event: string, payload: unknown }>> = []
const subscriptions = new Map<string, (payload: unknown) => void>()
let released = 0

const initial: BrowserWorkspace = {
  workspace: "workspace:client",
  lifecycle: "client",
  revision: 0,
  active: null,
  sessions: []
}

const created: BrowserSnapshot = {
  session: "session:first",
  url: "about:blank",
  title: "",
  viewport: { width: 720, height: 440 },
  image: "AA==",
  capturedAt: 1
}

const boundary: WorkspaceBoundary = {
  async ask<Answer>(event: string, payload?: unknown) {
    questions.push({ event, payload })
    if (event === "session.create") return created as Answer
    if (event === "workspace.read") return projected as Answer
    return undefined as Answer
  },
  publish(event, payload) { publications.push({ event, payload }) },
  subscribe(event, receive) {
    subscriptions.set(event, receive)
    return () => subscriptions.delete(event)
  }
}

const workspace = new Workspace(initial, boundary, () => { released += 1 })

assert.equal(questions.length, 0)
assert.equal(workspace.sessions.length, 0)
assert.equal(workspace.active, null)

let changes = 0
workspace.subscribe(() => { changes += 1 })

const projected: BrowserWorkspace = {
  ...initial,
  revision: 1,
  active: created.session,
  sessions: [created]
}

workspace.synchronize(projected)
workspace.synchronize(initial)

assert.equal(changes, 1)
assert.equal(workspace.active, created.session)
assert.deepEqual(workspace.sessions, [created])

assert.equal(await workspace.create({ width: 720, height: 440 }), created)
await workspace.resize(created.session, { width: 800, height: 500 })
await workspace.select(created.session)

assert.deepEqual(questions.slice(-3), [
  {
    event: "session.create",
    payload: { workspace: initial.workspace, viewport: { width: 720, height: 440 } }
  },
  {
    event: "input",
    payload: {
      action: "resize",
      workspace: initial.workspace,
      session: created.session,
      viewport: { width: 800, height: 500 }
    }
  },
  {
    event: "input",
    payload: { action: "session.select", workspace: initial.workspace, session: created.session }
  }
])

let frame: BrowserFrame | undefined
const stop = workspace.frames("frame:00000000-0000-0000-0000-000000000000", value => { frame = value })
subscriptions.get("frame:00000000-0000-0000-0000-000000000000")?.({ ...created, sequence: 2 })
assert.equal(frame?.sequence, 2)
stop()

workspace.keepFrames(created.session, "frame:00000000-0000-0000-0000-000000000000")
assert.equal(publications.at(-1)?.event, "stream.keepalive")

workspace.invalidate()
assert.equal(released, 1)
assert.throws(() => workspace.create({ width: 720, height: 440 }), /closed/)
