import assert from "node:assert/strict"
import Application from "../server/core/application"
import ChromiumEngine from "../server/core/chromium"
import { test } from "vitest"

test("Chromium executes navigation, input, and isolated Workspace state", async () => {
  const engine = new ChromiumEngine()

  try {
    const first = await engine.createWorkspace()
    const second = await engine.createWorkspace()
    const page = await first.open({ width: 640, height: 480 })
    const isolated = await second.open({ width: 320, height: 240 })

    await page.navigate("data:text/html,<title>Flambo test</title><input autofocus>")
    await page.type("shared input")
    const state = await page.state()
    const frame = await page.capture()
    const streamed = new Promise<Uint8Array>(async resolve => {
      let release: () => void = () => undefined
      release = await page.observeFrames(value => {
        release()
        resolve(value.data)
      })
      await page.reload()
    })

    assert.equal(state.title, "Flambo test")
    assert.equal(state.canGoBack, true)
    assert.equal(state.canGoForward, false)
    assert.deepEqual(state.viewport, { width: 640, height: 480 })
    assert.equal((await isolated.state()).url, "about:blank")
    assert.deepEqual([...frame.slice(0, 3)], [0xff, 0xd8, 0xff])
    assert.ok(frame.byteLength > 1_000)
    assert.ok((await streamed).byteLength > 1_000)

    await first.close()
    await second.close()
  } finally {
    await engine.close()
  }
})

test("Application publishes every real Chromium Workspace revision", async () => {
  const application = new Application(new ChromiumEngine(), {
    async create(workspace) {
      let exited = false
      return {
        identity: workspace,
        assignment: workspace,
        subscribeExit: () => () => undefined,
        exited: async () => exited,
        exit: async () => { exited = true }
      }
    }
  })
  const revisions: number[] = []

  try {
    application.subscribe(event => {
      if (event.type === "workspace.changed") revisions.push(event.snapshot.revision)
    })

    const workspace = await application.createWorkspace()
    const tab = await workspace.createTab({ width: 640, height: 480 })
    await workspace.resize(tab.id, { width: 800, height: 600 })
    await workspace.navigate(tab.id, "data:text/html,<title>Published navigation</title>")

    assert.deepEqual(revisions, [0, 1, 2, 3])
    assert.equal((await workspace.snapshot()).tabs[0]?.title, "Published navigation")
  } finally {
    await application.dispose()
  }
})
