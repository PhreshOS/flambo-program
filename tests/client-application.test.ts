import assert from "node:assert/strict"
import type { BrowserWorkspace } from "@server/core/browser"
import { beforeEach, test, vi } from "vitest"

type Listener = (value: unknown) => void

const boundary = vi.hoisted(() => {
  const listeners = new Map<string, Set<Listener>>()

  return {
    listeners,
    attach: Promise.resolve<BrowserWorkspace>(undefined as never),
    available: true,
    emit(event: string, value: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value)
    },
    service: {
      lifecycle: {
        subscribe(event: string, listener: Listener) {
          const key = `lifecycle:${event}`
          const current = listeners.get(key) ?? new Set()
          current.add(listener)
          listeners.set(key, current)
          return () => current.delete(listener)
        }
      },
      subscribe(event: string, listener: Listener) {
        const current = listeners.get(event) ?? new Set()
        current.add(listener)
        listeners.set(event, current)
        return () => current.delete(listener)
      },
      timeout() {
        return {
          ask<Answer>(event: string) {
            if (event !== "workspace.attach") throw new Error(`Unexpected event ${event}`)
            return boundary.attach as Promise<Answer>
          }
        }
      },
      async available() { return boundary.available },
      async waitReady() {},
      publish() {}
    }
  }
})

vi.mock("@phreshos/client", () => ({
  context: {
    async options() { return "workspace:client" },
    async program() { throw new Error("The test Service is already available") }
  },
  system: {
    service: {
      prepare() { return boundary.service }
    }
  }
}))

import Application from "@client/core/application"

beforeEach(() => {
  boundary.listeners.clear()
  boundary.available = true
})

test("a Workspace change received during attachment is reconciled after attachment", async () => {
  let resolveAttach!: (workspace: BrowserWorkspace) => void
  boundary.attach = new Promise(resolve => { resolveAttach = resolve })

  const application = new Application()
  const attaching = application.workspace()
  await vi.waitFor(() => assert.equal(boundary.listeners.has("workspace.change"), true))

  boundary.emit("workspace.change", workspace(2, "second"))
  boundary.emit("workspace.change", workspace(1, "first"))
  resolveAttach(workspace(0))

  const attached = await attaching
  assert.equal(attached.active, "second")
  assert.deepEqual(attached.sessions.map(session => session.session), ["second"])
  application.dispose()
})

test("a Workspace change received after attachment is applied immediately", async () => {
  boundary.attach = Promise.resolve(workspace(0))

  const application = new Application()
  const attached = await application.workspace()
  let changes = 0
  attached.subscribe(() => { changes += 1 })

  boundary.emit("workspace.change", workspace(1, "first"))

  assert.equal(changes, 1)
  assert.equal(attached.active, "first")
  application.dispose()
})

function workspace(revision: number, session?: string): BrowserWorkspace {
  return {
    workspace: "workspace:client",
    lifecycle: "client",
    revision,
    active: session ?? null,
    sessions: session ? [{
      session,
      url: "about:blank",
      title: "",
      viewport: { width: 720, height: 440 }
    }] : []
  }
}
