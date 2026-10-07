import { randomUUID } from "node:crypto"
import type { OpenedPage } from "../browser"
import type Capture from "../capture/capture"
import type { TabReport } from "../capture/capture"
import { searchEngine } from "@shared/search"
import Video, { type VideoPiece } from "./video"

export type { VideoPiece }

/** What a tab shows and where it stands in its history. */
export type TabDescription = Readonly<{
    tab: string
    title: string
    url: string
    favicon: string | null
    loading: boolean
    canGoBack: boolean
    canGoForward: boolean
}>

/** The room a tab's page is given: its size in CSS pixels, and how many device pixels each one is. */
export type Viewport = Readonly<{ width: number, height: number, scale: number }>

export type MouseButton = "left" | "middle" | "right"

/** A pointer at a point of the page, in CSS pixels from its top left corner. */
export type PointerInput =
    | Readonly<{ type: "move", x: number, y: number }>
    | Readonly<{ type: "down" | "up", x: number, y: number, button: MouseButton, clickCount: number }>
    | Readonly<{ type: "wheel", x: number, y: number, deltaX: number, deltaY: number }>

/**
 * A key, named as the DOM names it, such as "a", "Enter", or "Shift". "ControlOrMeta" is the key that
 * holds shortcuts on the machine the page runs on: Meta on macOS, Control elsewhere.
 */
export type KeyInput = Readonly<{ type: "down" | "up", key: string }>

export type TabEvent =
    | Readonly<{ type: "changed" }>
    | Readonly<{ type: "video", piece: VideoPiece }>
    | Readonly<{ type: "closed" }>

/** The room a tab has until its window gives it its own. */
const startingViewport: Viewport = { width: 1100, height: 640, scale: 1 }


/**
 * One page in Chromium, as Flambo shows it: its state as Chromium reports it, its video while it is
 * watched, and the input people and agents give it.
 */
export default class Tab {
    public readonly identity = randomUUID()
    private readonly listeners = new Set<(event: TabEvent) => void>()
    private readonly video: Video
    private readonly stopReports: () => void
    private report: TabReport = { title: "", url: "about:blank", favicon: null, loading: false }
    private history = { canGoBack: false, canGoForward: false }
    private ended = false
    private overlay: Promise<unknown> | null = null

    public constructor(private readonly opened: OpenedPage, capture: Capture) {
        this.video = new Video(capture, opened.tab, devicePixels(startingViewport), () => this.repaint(), piece => this.emit({ type: "video", piece }))
        void this.resize(startingViewport).catch(() => undefined)
        this.stopReports = capture.follow(opened.tab, report => void this.reported(report))
        opened.page.on("close", () => this.end())
        // A page's own dialogs would stop it until answered; Flambo does not show them yet.
        opened.page.on("dialog", dialog => void dialog.dismiss().catch(() => undefined))
    }

    public get page() {
        return this.opened.page
    }

    /**
     * The tab as people see it. A blank page has no address of its own: it is a new tab, which a
     * window shows by itself, without the page's picture.
     */
    public description(): TabDescription {
        const report = this.report.url === "about:blank" ? { ...this.report, title: "", url: "", favicon: null } : this.report
        return Object.freeze({ tab: this.identity, ...report, ...this.history })
    }

    public subscribe(listener: (event: TabEvent) => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }

    /** Goes to an address, or searches for the words when they are not one. */
    public async navigate(input: string) {
        await this.page.goto(destination(input), { waitUntil: "commit" })
    }

    /** Searches for the words with Flambo's search engine, whatever they look like. */
    public async search(text: string) {
        await this.page.goto(searchEngine.address + encodeURIComponent(text.trim()), { waitUntil: "commit" })
    }

    public async back() {
        await this.page.goBack({ waitUntil: "commit" })
    }

    public async forward() {
        await this.page.goForward({ waitUntil: "commit" })
    }

    public async reload() {
        await this.page.reload({ waitUntil: "commit" })
    }

    public async resize(viewport: Viewport) {
        const { width, height, scale } = viewport
        await this.opened.session.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: scale, mobile: false })
        this.video.resize(devicePixels(viewport))
    }

    /** Pages that offer light and dark choose by this, as they would by the system's own theme. */
    public async scheme(theme: "light" | "dark") {
        await this.opened.session.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] })
    }

    public async pointer(input: PointerInput) {
        const { mouse } = this.page
        if (input.type === "move") return await mouse.move(input.x, input.y)
        await mouse.move(input.x, input.y)
        if (input.type === "wheel") return await mouse.wheel(input.deltaX, input.deltaY)
        const options = { button: input.button, clickCount: input.clickCount }
        await (input.type === "down" ? mouse.down(options) : mouse.up(options))
    }

    public async key(input: KeyInput) {
        await (input.type === "down" ? this.page.keyboard.down(input.key) : this.page.keyboard.up(input.key))
    }

    /** Types text as it is, such as text pasted or composed, without pressing keys for it. */
    public async insert(text: string) {
        await this.page.keyboard.insertText(text)
    }

    /** Presses a key or a combination such as "ControlOrMeta+A", as an agent would. */
    public async press(keys: string) {
        await this.page.keyboard.press(keys)
    }

    /** The page as a tree of what it offers people: headings, text, links, buttons, and fields. */
    public async text() {
        return await this.page.locator("body").ariaSnapshot()
    }

    public async picture() {
        return new Uint8Array(await this.page.screenshot({ type: "jpeg", quality: 80 }))
    }

    public watch(watcher: string) {
        return this.video.watch(watcher)
    }

    public unwatch(watcher: string) {
        this.video.unwatch(watcher)
    }

    public acknowledge(watcher: string, sequence: number) {
        this.video.acknowledge(watcher, sequence)
    }

    public async close() {
        await this.page.close()
    }

    /**
     * Has Chromium draw the page once more. Chromium draws only what changes; a highlight that covers
     * nothing visible, shown and hidden at once, is a change that changes nothing on the page.
     */
    private async repaint() {
        const { session } = this.opened
        this.overlay ??= session.send("DOM.enable").then(() => session.send("Overlay.enable"))
        await this.overlay
        await session.send("Overlay.highlightRect", { x: 0, y: 0, width: 1, height: 1, color: { r: 0, g: 0, b: 0, a: 0 } })
        await session.send("Overlay.hideHighlight")
    }

    private async reported(report: TabReport) {
        this.report = report
        const { currentIndex, entries } = await this.opened.session.send("Page.getNavigationHistory").catch(() => ({ currentIndex: 0, entries: [] }))
        this.history = { canGoBack: currentIndex > 0, canGoForward: currentIndex < entries.length - 1 }
        this.emit({ type: "changed" })
    }

    private end() {
        if (this.ended) return
        this.ended = true
        this.stopReports()
        this.video.close()
        this.emit({ type: "closed" })
        this.listeners.clear()
    }

    private emit(event: TabEvent) {
        for (const listener of this.listeners) listener(event)
    }
}

function devicePixels({ width, height, scale }: Viewport) {
    return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/** An address as typed, completed with its scheme; anything that cannot be an address is searched for. */
export function destination(input: string) {
    const text = input.trim()
    if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^[^\s/]+:\d+(\/|$)/.test(text)) return text
    if (!/\s/.test(text) && (/^[^\s/]+\.[^\s/]+/.test(text) || /^localhost(:\d+)?(\/|$)/.test(text) || /^[^\s/]+:\d+(\/|$)/.test(text)))
        return `${/^(localhost|127\.|\[::1\])/.test(text) ? "http" : "https"}://${text}`
    return searchEngine.address + encodeURIComponent(text)
}
