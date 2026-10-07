// The extension's side of Flambo's control line. Flambo's Server connects it once Chromium starts;
// from then on the extension reports every tab's state and starts captures when asked.

let control = null
let creating = null

self.connect = url => new Promise((resolve, reject) => {
    const socket = new WebSocket(url)
    socket.onopen = () => {
        control = socket
        // A service worker sleeps after 30 quiet seconds; a message every 20 keeps it awake.
        setInterval(() => send({ type: "alive" }), 20_000)
        resolve()
    }
    socket.onerror = () => reject(new Error("The capture extension could not reach Flambo's Server"))
    socket.onmessage = event => void answer(JSON.parse(event.data))
})

function send(message) {
    if (control?.readyState === WebSocket.OPEN) control.send(JSON.stringify(message))
}

async function answer(message) {
    try {
        send({ type: "reply", id: message.id, value: await perform(message) })
    }
    catch (error) {
        send({ type: "reply", id: message.id, error: String(error?.message ?? error) })
    }
}

async function perform(message) {
    if (message.type === "tab") {
        const target = (await chrome.debugger.getTargets()).find(target => target.id === message.target)
        if (target?.tabId === undefined) throw new Error("No tab shows this page")
        return target.tabId
    }
    if (message.type === "capture") {
        const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: message.tab })
        await offscreen()
        const result = await chrome.runtime.sendMessage({ to: "offscreen", type: "capture", streamId, url: message.url, width: message.width, height: message.height, codec: message.codec })
        if (result?.error) throw new Error(result.error)
        return null
    }
    if (message.type === "sites") return await sites(message.limit)
    if (message.type === "release") {
        if (!(await chrome.offscreen.hasDocument())) return null
        const result = await chrome.runtime.sendMessage({ to: "offscreen", type: "release", url: message.url })
        if (result?.error) throw new Error(result.error)
        return null
    }
    throw new Error(`Unknown request ${message.type}`)
}

/**
 * The places on the web visited most, each with its icon as Chromium keeps it, written out in full so
 * whoever shows it needs nothing from the extension.
 */
async function sites(limit) {
    const visited = (await chrome.topSites.get()).filter(site => /^https?:/.test(site.url) && !site.url.startsWith("https://chromewebstore.google.com"))
    return await Promise.all(visited.slice(0, limit).map(async site => ({ url: site.url, title: site.title || new URL(site.url).hostname, icon: await icon(site.url) })))
}

async function icon(page) {
    const response = await fetch(chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(page)}&size=32`))
    if (!response.ok) return null
    const bytes = new Uint8Array(await response.arrayBuffer())
    let text = ""
    for (const byte of bytes) text += String.fromCharCode(byte)
    return `data:${response.headers.get("content-type") ?? "image/png"};base64,${btoa(text)}`
}

/** Captures run in one hidden document, the only place an extension may hold a media stream. */
async function offscreen() {
    if (await chrome.offscreen.hasDocument()) return
    creating ??= chrome.offscreen.createDocument({ url: "offscreen.html", reasons: ["USER_MEDIA"], justification: "Captures tabs as video for Flambo" })
        .finally(() => { creating = null })
    await creating
}

chrome.tabs.onUpdated.addListener((tab, _change, state) => send({
    type: "updated", tab, title: state.title ?? "", url: state.url ?? "", favicon: state.favIconUrl ?? null, loading: state.status === "loading"
}))
