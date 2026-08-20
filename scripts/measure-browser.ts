import ChromiumEngine from "@libs/browser-engine"
import BrowserSessions from "@server/core/browser-sessions"

const requested = Number(process.argv[2] ?? 4)

if (!Number.isInteger(requested) || requested < 1 || requested > 64) {
  throw new Error("Pass a browser session count between 1 and 64")
}

const engine = new ChromiumEngine()
const sessions = new BrowserSessions(engine, { total: requested, perOwner: 1 })
const started = performance.now()
let result: Record<string, unknown> | undefined

try {
  const snapshots = await Promise.all(Array.from({ length: requested }, (_, index) => {
    return sessions.create(`measure:${index}`, { width: 800, height: 500 })
  }))
  const ready = performance.now()

  await Promise.all(snapshots.map((snapshot, index) => {
    const document = encodeURIComponent(`<style>@keyframes move{to{transform:translateX(500px)}}</style><main style="font:24px system-ui;animation:move 800ms alternate infinite">Browser session ${index + 1}</main>`)
    return sessions.navigate(`measure:${index}`, snapshot.session, `data:text/html,${document}`)
  }))

  const images = Array<string>(requested).fill("")
  const frames = snapshots.map((snapshot, index) => new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Browser session ${index + 1} produced no frame`)), 5_000)
    let first = true

    void sessions.startFrames(`measure:${index}`, snapshot.session, `frame:${index}`, frame => {
      images[index] = frame.image
      if (!first) return
      first = false
      clearTimeout(timeout)
      resolve()
    }).catch(error => {
      clearTimeout(timeout)
      reject(error)
    })
  }))
  await Promise.all(frames)

  const streamStarted = performance.now()
  const framesBefore = sessions.metrics().streams.frames
  await new Promise(resolve => setTimeout(resolve, 1_000))
  const streamMilliseconds = performance.now() - streamStarted
  const metrics = sessions.metrics()
  const streamedFrames = metrics.streams.frames - framesBefore

  result = {
    sessions: requested,
    readyMilliseconds: ready - started,
    measuredMilliseconds: performance.now() - started,
    coordinatorResidentMemoryBytes: process.memoryUsage().rss,
    streamMilliseconds,
    streamedFrames,
    framesPerSecond: streamedFrames / streamMilliseconds * 1_000,
    latestFramePayloadBytes: images.reduce((total, image) => total + image.length, 0),
    metrics
  }

  await Promise.all(snapshots.map((snapshot, index) => {
    return sessions.stopFrames(`measure:${index}`, snapshot.session, `frame:${index}`)
  }))
} finally {
  const cleanupStarted = performance.now()
  await sessions.dispose()
  if (result) result.cleanupMilliseconds = performance.now() - cleanupStarted
}

process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
