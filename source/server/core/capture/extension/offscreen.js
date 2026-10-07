// Captures one tab per request and sends it, encoded as video, over its own socket to Flambo's Server.
// The Server asks for a key frame by sending "key" on the socket. It ends a capture by asking for its
// release, which answers once the tab is free to be captured again.

/** Each capture's way to end, by the address of its socket. */
const releases = new Map()

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.to !== "offscreen") return
    const done = message.type === "capture" ? capture(message.streamId, message.url, message.width, message.height)
        : message.type === "release" ? Promise.resolve(releases.get(message.url)?.())
        : null
    if (!done) return
    done.then(() => reply(null), error => reply({ error: String(error?.message ?? error) }))
    return true
})

async function capture(streamId, url, width, height) {
    // A tab is captured at exactly the size of its page in device pixels. Chromium keeps the size a
    // capture starts with, so a page that changes size is captured anew.
    const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId, minWidth: width, maxWidth: width, minHeight: height, maxHeight: height, maxFrameRate: 60 } }
    })
    const [track] = stream.getVideoTracks()
    const socket = new WebSocket(url)
    socket.binaryType = "arraybuffer"
    await new Promise((resolve, reject) => {
        socket.onopen = resolve
        socket.onerror = () => reject(new Error("The capture could not reach Flambo's Server"))
    })
    releases.set(url, () => {
        releases.delete(url)
        track.stop()
        socket.close()
    })
    void encode(track, socket)
}

/** How many bits a second each pixel may use; a still page uses far less, since nothing changes. */
const bitsPerPixel = 3
const largestBitrate = 20_000_000

async function encode(track, socket) {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    let encoder = null
    let size = ""
    let key = true
    // The newest picture, kept so a key piece can be made at once even while the page stays still
    // and Chromium sends no new pictures.
    let last = null
    socket.onmessage = event => {
        if (event.data !== "key") return
        if (last && encoder?.state === "configured") encoder.encode(last.clone(), { keyFrame: true })
        else key = true
    }
    socket.onclose = () => { last?.close(); track.stop(); void reader.cancel() }
    for (;;) {
        const { value: frame, done } = await reader.read()
        if (done) break
        // An encoder that has fallen behind skips frames rather than delaying every later one.
        if (encoder && encoder.encodeQueueSize > 1) { frame.close(); continue }
        const { displayWidth: width, displayHeight: height } = frame
        if (`${width}x${height}` !== size) {
            size = `${width}x${height}`
            if (encoder?.state === "configured") encoder.close()
            encoder = new VideoEncoder({ output: chunk => send(socket, chunk, width, height), error: () => socket.close() })
            encoder.configure({
                codec: "vp8", width, height, framerate: 60, latencyMode: "realtime", bitrateMode: "variable",
                bitrate: Math.min(largestBitrate, width * height * bitsPerPixel)
            })
            key = true
        }
        encoder.encode(frame, { keyFrame: key })
        key = false
        last?.close()
        last = frame
    }
    if (encoder?.state === "configured") encoder.close()
}

/** One message per chunk: whether it is a key frame, the picture's size, its time, then its data. */
function send(socket, chunk, width, height) {
    if (socket.readyState !== WebSocket.OPEN) return
    const message = new ArrayBuffer(13 + chunk.byteLength)
    const view = new DataView(message)
    view.setUint8(0, chunk.type === "key" ? 1 : 0)
    view.setUint16(1, width)
    view.setUint16(3, height)
    view.setFloat64(5, chunk.timestamp)
    chunk.copyTo(new Uint8Array(message, 13))
    socket.send(message)
}
