import { createHash, randomBytes, randomUUID } from "node:crypto"
import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises"
import type { AddressInfo } from "node:net"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Worker } from "playwright"
import { WebSocketServer, type WebSocket } from "ws"
import { videoCodec } from "@shared/video"

/** The capture extension as Flambo ships it: beside this module, or beside the built Server. */
const shippedExtension = fileURLToPath(new URL("./extension", import.meta.url))

/** The capture extension as Chromium loads it, and the identity Chromium gives it. */
export type Extension = Readonly<{ folder: string, identity: string }>

/**
 * Places the capture extension where Chromium loads it, in a folder named after its contents, and
 * removes the folders of earlier contents. Chromium keeps an extension's worker in its profile and
 * would run an old one even after its files change, but a new folder is a new extension to it.
 */
export async function placeExtension(parent: string): Promise<Extension> {
    const hash = createHash("sha256")
    for (const file of (await readdir(shippedExtension)).sort()) hash.update(file).update(await readFile(join(shippedExtension, file)))
    const name = `extension-${hash.digest("hex").slice(0, 16)}`
    const folder = join(parent, name)
    await mkdir(parent, { recursive: true })
    for (const earlier of await readdir(parent)) if (earlier.startsWith("extension-") && earlier !== name) await rm(join(parent, earlier), { recursive: true, force: true })
    await cp(shippedExtension, folder, { recursive: true })
    // Chromium names an extension loaded from a folder after the folder's path.
    const identity = [...createHash("sha256").update(folder).digest("hex").slice(0, 32)]
        .map(digit => String.fromCharCode(97 + parseInt(digit, 16)))
        .join("")
    return { folder, identity }
}

/** One piece of a tab's video. A key piece can be shown alone; every other one follows the piece before it. */
export type VideoChunk = Readonly<{ key: boolean, width: number, height: number, timestamp: number, data: Uint8Array }>

/** What Chromium itself says about a tab. */
export type TabReport = Readonly<{ title: string, url: string, favicon: string | null, loading: boolean }>

/** A place on the web visited often, with its icon as a data address, when Chromium has one. */
export type Site = Readonly<{ url: string, title: string, icon: string | null }>

/** How large a tab's picture is captured, in device pixels. */
export type CaptureSize = Readonly<{ width: number, height: number }>

/** A tab's video while it is captured. */
export type VideoStream = Readonly<{
    /** Asks for a key piece next, from which the video can be shown again. */
    key(): void
    /** Ends the capture; it resolves once the tab is free to be captured again. */
    close(): Promise<void>
}>

type Pending = { resolve(value: unknown): void, reject(error: Error): void }

/**
 * Chromium's side of Flambo: the capture extension, reached over a local socket only this Server
 * knows. It names the tab behind a page, reports each tab's state, and captures tabs as video.
 */
export default class Capture {
    private readonly token = randomBytes(24).toString("hex")
    private readonly replies = new Map<string, Pending>()
    private readonly streams = new Map<string, Readonly<{ receive(chunk: VideoChunk): void, opened(socket: WebSocket): void }>>()
    private readonly reports = new Map<number, (report: TabReport) => void>()
    private control: WebSocket | null = null

    private constructor(private readonly server: WebSocketServer) {
        server.on("connection", (socket, request) => this.connected(socket, request.url ?? ""))
    }

    /** Opens the local socket and connects the extension running in Chromium to it. */
    public static async connect(worker: Worker) {
        const server = new WebSocketServer({ host: "127.0.0.1", port: 0, maxPayload: 64 * 1024 * 1024 })
        await new Promise<void>((resolve, reject) => server.once("listening", resolve).once("error", reject))
        const capture = new Capture(server)
        await worker.evaluate(url => (self as unknown as { connect(url: string): Promise<void> }).connect(url), capture.address("control"))
        return capture
    }

    /** The tab Chromium shows a page in, by the page's target. */
    public async tab(target: string) {
        return await this.request("tab", { target }) as number
    }

    /** Follows what Chromium reports about one tab, until the returned function stops it. */
    public follow(tab: number, report: (report: TabReport) => void) {
        this.reports.set(tab, report)
        return () => { this.reports.delete(tab) }
    }

    /** The places on the web visited most, at most this many. */
    public async sites(limit: number) {
        return await this.request("sites", { limit }) as readonly Site[]
    }

    /** Starts capturing a tab at a size; its pieces arrive in order until the stream is closed. */
    public async stream(tab: number, size: CaptureSize, receive: (chunk: VideoChunk) => void): Promise<VideoStream> {
        const identity = randomUUID()
        const socket = new Promise<WebSocket>(opened => this.streams.set(identity, { receive, opened }))
        const url = this.address(identity)
        try {
            await this.request("capture", { tab, ...size, url, codec: videoCodec })
            const open = await socket
            return {
                key: () => open.send("key"),
                close: async () => {
                    this.streams.delete(identity)
                    await this.request("release", { url }).catch(() => undefined)
                    open.close()
                }
            }
        }
        catch (error) {
            this.streams.delete(identity)
            throw error
        }
    }

    public close() {
        for (const socket of this.server.clients) socket.terminate()
        this.server.close()
    }

    private address(path: string) {
        return `ws://127.0.0.1:${(this.server.address() as AddressInfo).port}/${this.token}/${path}`
    }

    private connected(socket: WebSocket, url: string) {
        const [, token, path] = url.split("/")
        if (token !== this.token) return socket.close()
        if (path === "control") {
            this.control = socket
            socket.on("message", data => this.controlMessage(JSON.parse(String(data))))
            return
        }
        const stream = this.streams.get(path)
        if (!stream) return socket.close()
        stream.opened(socket)
        socket.on("message", (data: Buffer) => stream.receive(chunk(data)))
    }

    private controlMessage(message: Record<string, unknown>) {
        if (message.type === "reply") {
            const pending = this.replies.get(message.id as string)
            this.replies.delete(message.id as string)
            if (message.error) pending?.reject(new Error(message.error as string))
            else pending?.resolve(message.value)
        }
        else if (message.type === "updated") {
            const { title, url, favicon, loading } = message as TabReport
            this.reports.get(message.tab as number)?.({ title, url, favicon, loading })
        }
    }

    private request(type: string, values: Record<string, unknown>) {
        const control = this.control
        if (!control) return Promise.reject(new Error("The capture extension is not connected"))
        const id = randomUUID()
        return new Promise<unknown>((resolve, reject) => {
            this.replies.set(id, { resolve, reject })
            control.send(JSON.stringify({ ...values, type, id }))
        })
    }
}

/** Reads one piece as the extension wrote it: key flag, width, height, time, then the data. */
function chunk(data: Buffer): VideoChunk {
    return {
        key: data.readUInt8(0) === 1,
        width: data.readUInt16BE(1),
        height: data.readUInt16BE(3),
        timestamp: data.readDoubleBE(5),
        data: new Uint8Array(data.buffer, data.byteOffset + 13, data.byteLength - 13)
    }
}
