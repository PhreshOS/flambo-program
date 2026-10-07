// Captures one tab per request and sends it, encoded as video, over its own socket to Flambo's Server.
// The Server asks for a key frame by sending "key" on the socket. It ends a capture by asking for its
// release, which answers once the tab is free to be captured again.

/** Each capture's way to end, by the address of its socket. */
const releases = new Map()

chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.to !== "offscreen") return
    const done = message.type === "capture" ? capture(message.streamId, message.url, message.width, message.height, message.codec)
        : message.type === "release" ? Promise.resolve(releases.get(message.url)?.())
        : null
    if (!done) return
    done.then(() => reply(null), error => reply({ error: String(error?.message ?? error) }))
    return true
})

async function capture(streamId, url, width, height, codec) {
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
    void encode(track, socket, codec)
}

/**
 * How much detail each picture keeps, from 0, everything, to 63: a moving page is sent lighter, and
 * once it stands still for a moment its last picture is sent again, sharp.
 */
const movingQuantizer = 30
const stillQuantizer = 4
const stillAfter = 160

async function encode(track, socket, codec) {
    const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
    let encoder = null
    let size = ""
    let key = true
    // The newest picture, kept so a key piece can be made at once even while the page stays still
    // and Chromium sends no new pictures, and so it can be sent again sharp once the page is still.
    let last = null
    let sharp = false
    let stillTimer
    const sendSharp = keyFrame => {
        if (!last || encoder?.state !== "configured") return false
        // The encoder does not close what it is given; a copy left open holds one of the few pictures
        // Chromium lends a capture, and once they are all held, the capture stops.
        const copy = last.clone()
        encoder.encode(copy, { keyFrame, vp9: { quantizer: stillQuantizer } })
        copy.close()
        sharp = true
        return true
    }
    socket.onmessage = event => {
        if (event.data === "key" && !sendSharp(true)) key = true
    }
    socket.onclose = () => { clearTimeout(stillTimer); last?.close(); track.stop(); void reader.cancel() }
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
            encoder.configure({ codec, width, height, framerate: 60, latencyMode: "realtime", bitrateMode: "quantizer" })
            key = true
        }
        encoder.encode(frame, { keyFrame: key, vp9: { quantizer: movingQuantizer } })
        key = false
        last?.close()
        last = frame
        sharp = false
        clearTimeout(stillTimer)
        stillTimer = setTimeout(() => { if (!sharp) sendSharp(false) }, stillAfter)
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
