import { expect, test } from "vitest"
import type Capture from "@server/core/capture/capture"
import type { CaptureSize, VideoChunk } from "@server/core/capture/capture"
import Video, { type VideoPiece } from "@server/core/tab/video"

/** A capture that sends what the test gives it, and records what Video asks of it. */
function fakeCapture() {
    const streams: { size: CaptureSize, receive(chunk: VideoChunk): void, keys: number, closed: boolean }[] = []
    const capture = {
        async stream(_tab: number, size: CaptureSize, receive: (chunk: VideoChunk) => void) {
            const stream = { size, receive, keys: 0, closed: false }
            streams.push(stream)
            return { key: () => { stream.keys++ }, close: async () => { stream.closed = true } }
        }
    } as unknown as Capture
    return { capture, streams }
}

const piece = (key: boolean): VideoChunk => ({ key, width: 4, height: 4, timestamp: 0, data: new Uint8Array(1) })
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test("a watched video starts at a key piece and leaves numbered", async () => {
    const { capture, streams } = fakeCapture()
    const sent: VideoPiece[] = []
    const video = new Video(capture, 1, { width: 4, height: 4 }, async () => undefined, piece => sent.push(piece))
    await video.watch("window")
    streams[0].receive(piece(false))
    streams[0].receive(piece(true))
    streams[0].receive(piece(false))
    expect(sent.map(piece => [piece.sequence, piece.key])).toEqual([[1, true], [2, false]])
})

test("a watcher far behind skips to a fresh key piece", async () => {
    const { capture, streams } = fakeCapture()
    const sent: VideoPiece[] = []
    const video = new Video(capture, 1, { width: 4, height: 4 }, async () => undefined, piece => sent.push(piece))
    await video.watch("window")
    streams[0].receive(piece(true))
    for (let index = 0; index < 20; index++) streams[0].receive(piece(false))
    // Ten pieces may wait unshown; the rest are dropped.
    expect(sent).toHaveLength(11)
    video.acknowledge("window", 11)
    await settle()
    expect(streams[0].keys).toBe(1)
    streams[0].receive(piece(false))
    streams[0].receive(piece(true))
    expect(sent.at(-1)).toMatchObject({ sequence: 12, key: true })
})

test("a new size is captured anew, and the last watcher ends the capture", async () => {
    const { capture, streams } = fakeCapture()
    const video = new Video(capture, 1, { width: 4, height: 4 }, async () => undefined, () => undefined)
    await video.watch("window")
    video.resize({ width: 8, height: 6 })
    await settle()
    expect(streams).toHaveLength(2)
    expect(streams[0].closed).toBe(true)
    expect(streams[1].size).toEqual({ width: 8, height: 6 })
    video.unwatch("window")
    await settle()
    expect(streams[1].closed).toBe(true)
})
