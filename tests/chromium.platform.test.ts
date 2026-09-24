import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { createServer } from "node:http"
import type { AddressInfo } from "node:net"
import Application from "../server/core/application"
import type { BrowserFrame } from "../server/core/browser-engine"
import ChromiumEngine from "../server/core/chromium"
import { test } from "vitest"

test("Chromium executes navigation, input, and isolated Workspace state", async () => {
  const engine = new ChromiumEngine()

  try {
    const first = await engine.createWorkspace()
    const second = await engine.createWorkspace()
    const page = await first.open({ width: 960, height: 540 })
    const isolated = await second.open({ width: 320, height: 240 })

    await page.navigate("data:text/html,<title>Flambo test</title><input autofocus>")
    await page.type("shared input")
    const state = await page.state()
    const frame = await page.capture()
    const streamed = new Promise<BrowserFrame>(async resolve => {
      let release: () => void = () => undefined
      release = await page.observeFrames(value => {
        release()
        resolve(value)
      })
      await page.reload()
    })

    assert.equal(state.title, "Flambo test")
    assert.equal(state.canGoBack, true)
    assert.equal(state.canGoForward, false)
    assert.deepEqual(state.viewport, { width: 960, height: 540 })
    assert.equal((await isolated.state()).url, "about:blank")
    assert.deepEqual([...frame.slice(0, 3)], [0xff, 0xd8, 0xff])
    assert.ok(frame.byteLength > 1_000)
    const stream = await streamed
    assert.deepEqual(jpegDimensions(stream.data), [960, 540])
    assert.deepEqual(stream.viewport, { width: 960, height: 540 })
    assert.ok(stream.data.byteLength > 1_000)

    await first.close()
    await second.close()
  } finally {
    await engine.close()
  }
})

test("Chromium captures the current page after frame observation starts", async () => {
  const engine = new ChromiumEngine()

  try {
    const context = await engine.createWorkspace()
    const page = await context.open({ width: 960, height: 540 })
    await page.navigate("data:text/html,<title>First page</title><main style='background:%23d45d22;width:100vw;height:100vh'>Ready</main>")

    const release = await page.observeFrames(() => undefined)
    try {
      const frame = await page.capture()
      assert.deepEqual(jpegDimensions(frame), [960, 540])
      assert.ok(frame.byteLength > 1_000)
    } finally {
      release()
      await context.close()
    }
  } finally {
    await engine.close()
  }
})

test("Chromium reads navigation history from the currently active page", async () => {
  const engine = new ChromiumEngine()

  try {
    const context = await engine.createWorkspace()
    const page = await context.open({ width: 640, height: 360 })
    await page.navigate("data:text/html,<title>First</title>")
    await page.navigate("data:text/html,<title>Second</title>")

    assert.deepEqual(await page.state(), {
      url: "data:text/html,<title>Second</title>",
      title: "Second",
      favicon: null,
      loading: false,
      canGoBack: true,
      canGoForward: false,
      viewport: { width: 640, height: 360 }
    })

    await page.back()
    assert.equal((await page.state()).canGoForward, true)
    await page.forward()
    assert.equal((await page.state()).title, "Second")
    await context.close()
  } finally {
    await engine.close()
  }
})

test("Chromium frame observation continues with later page paints", async () => {
  const engine = new ChromiumEngine()

  try {
    const context = await engine.createWorkspace()
    const page = await context.open({ width: 640, height: 360 })
    await page.navigate("data:text/html,<body style='margin:0;background:%23e33;width:100vw;height:100vh'><script>setTimeout(()=>document.body.style.background='%233e3',250);setTimeout(()=>document.body.style.background='%2333e',500)</script>")

    const frames = new Set<string>()
    const updated = Promise.withResolvers<void>()
    const release = await page.observeFrames(frame => {
      frames.add(createHash("sha256").update(frame.data).digest("hex"))
      if (frames.size >= 3) updated.resolve()
    })

    try {
      await Promise.race([
        updated.promise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Chromium did not publish later page paints")), 2_000))
      ])
      assert.ok(frames.size >= 3)
    } finally {
      release()
      await context.close()
    }
  } finally {
    await engine.close()
  }
})

test("Chromium reports loading for navigation initiated inside the page", async () => {
  const startIcon = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='16' height='16' fill='red'/></svg>"
  const nextIcon = "<svg xmlns='http://www.w3.org/2000/svg'><rect width='16' height='16' fill='green'/></svg>"
  const server = createServer((request, response) => {
    if (request.url === "/start.svg" || request.url === "/next.svg") {
      response.setHeader("content-type", "image/svg+xml")
      const icon = request.url === "/start.svg" ? startIcon : nextIcon
      if (request.url === "/next.svg") setTimeout(() => response.end(icon), 100)
      else response.end(icon)
      return
    }
    response.setHeader("content-type", "text/html")
    if (request.url === "/next") {
      setTimeout(() => response.end("<title>Next</title><link rel='icon' href='/next.svg'><script>addEventListener('load',()=>history.replaceState(null,'','/settled'))</script>Ready"), 100)
      return
    }
    response.end("<title>Start</title><link rel='icon' href='/start.svg'><a href='/next' style='position:fixed;inset:0'>Next</a>")
  })
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address() as AddressInfo
  const engine = new ChromiumEngine()

  try {
    const context = await engine.createWorkspace()
    const page = await context.open({ width: 640, height: 360 })
    await page.navigate(`http://127.0.0.1:${address.port}/`)
    const loading: boolean[] = []
    const release = page.observeLoading(value => loading.push(value))

    try {
      await waitFor(() => loading.at(-1) === false)
      loading.length = 0
      await page.click(10, 10, "left")
      await waitFor(() => loading.at(-1) === false && loading.includes(true))
      await waitFor(async () => (await page.state()).favicon !== null)
      assert.deepEqual(loading, [true, false])
      const state = await page.state()
      assert.equal(state.title, "Next")
      assert.equal(state.favicon, `data:image/svg+xml;base64,${Buffer.from(nextIcon).toString("base64")}`)
    } finally {
      release()
      await context.close()
    }
  } finally {
    await engine.close()
    await new Promise<void>(resolve => server.close(() => resolve()))
  }
})

function jpegDimensions(data: Uint8Array): readonly [number, number] | null {
  for (let offset = 2; offset + 8 < data.byteLength;) {
    if (data[offset] !== 0xff) {
      offset += 1
      continue
    }

    const marker = data[offset + 1]!
    const length = (data[offset + 2]! << 8) | data[offset + 3]!
    const dimensions = marker >= 0xc0 && marker <= 0xc3
      || marker >= 0xc5 && marker <= 0xc7
      || marker >= 0xc9 && marker <= 0xcb
      || marker >= 0xcd && marker <= 0xcf
    if (dimensions) {
      const height = (data[offset + 5]! << 8) | data[offset + 6]!
      const width = (data[offset + 7]! << 8) | data[offset + 8]!
      return [width, height]
    }
    offset += 2 + length
  }
  return null
}

async function waitFor(condition: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 2_000
  while (!await condition()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for Chromium navigation loading")
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

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

    const workspace = await application.createWorkspace({ width: 640, height: 480 })
    const tab = (await workspace.snapshot()).tabs[0]!
    await workspace.resize(tab.id, { width: 800, height: 600 })
    await workspace.navigate(tab.id, "data:text/html,<title>Published navigation</title>")

    assert.deepEqual(revisions, [1, 2, 3])
    assert.equal((await workspace.snapshot()).tabs[0]?.title, "Published navigation")
  } finally {
    await application.dispose()
  }
})
