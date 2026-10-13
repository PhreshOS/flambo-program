import type Browser from "./browser"
import type { OpenedPage } from "./browser"
import Tab, { type TabDescription, type VideoPiece } from "./tab/tab"

/** A tab and the window it belongs to. */
export type TabEntry = TabDescription & Readonly<{ window: string }>

/** What the tabs know of windows, from wherever windows live. */
export type Windows = Readonly<{
    /** Calls `ended` with each window that ends, from now on. */
    followEnds(ended: (window: string) => void): void
    /** Whether a window is still open. */
    exists(window: string): Promise<boolean>
}>

export type TabsEvent =
    | Readonly<{ type: "changed" }>
    | Readonly<{ type: "video", tab: string, piece: VideoPiece }>

/**
 * Every tab in Flambo's browser. Each belongs to the window that opened it and ends with it: whoever
 * wants a page to stay keeps its window open. A tab a page opens itself, such as a link meant for a
 * new tab, joins the window of the page that opened it.
 */
export default class Tabs {
    private readonly tabs = new Map<string, Tab>()
    private readonly windowOf = new Map<string, string>()
    private readonly listeners = new Set<(event: TabsEvent) => void>()

    public constructor(private readonly browser: Browser, private readonly windows: Windows) {
        windows.followEnds(window => this.windowEnded(window))
        browser.followPopups((opened, opener) => {
            const parent = [...this.tabs.values()].find(tab => tab.page === opener)
            const window = parent && this.windowOf.get(parent.identity)
            if (window) void this.add(opened, window)
            else void opened.page.close()
        })
    }

    public subscribe(listener: (event: TabsEvent) => void) {
        this.listeners.add(listener)
        return () => { this.listeners.delete(listener) }
    }

    public list(): readonly TabEntry[] {
        return [...this.tabs.values()].map(tab => this.entry(tab))
    }

    /** Opens a tab in a window, at an address or blank, as a new tab. */
    public async create(window: string, address?: string) {
        const tab = await this.add(await this.browser.open(), window)
        if (address) await tab.navigate(address)
        return this.entry(tab)
    }

    public get(identity: string) {
        const tab = this.tabs.get(identity)
        if (!tab) throw new Error("This tab has closed, or never existed")
        return tab
    }

    public async close(identity: string) {
        await this.get(identity).close()
    }

    /**
     * Moves a tab to a place among its window's tabs, counted from 0; past the last, it goes last.
     * Every window and agent then lists them in that order.
     */
    public move(identity: string, index: number) {
        this.get(identity)
        const window = this.windowOf.get(identity)!
        const order = [...this.tabs.keys()]
        const mine = order.filter(other => this.windowOf.get(other) === window)
        // Only the order within its window counts: already at that place, nothing moves.
        if (mine.indexOf(identity) === Math.min(index, mine.length - 1)) return
        const others = order.filter(other => other !== identity)
        const theirs = mine.filter(other => other !== identity)
        // It goes before the one now at its new place, or after its window's last tab.
        const before = theirs[index]
        const at = before !== undefined ? others.indexOf(before) : others.indexOf(theirs.at(-1)!) + 1
        const moved = [...others.slice(0, at), identity, ...others.slice(at)]
        const tabs = new Map(moved.map(other => [other, this.tabs.get(other)!]))
        this.tabs.clear()
        for (const [key, tab] of tabs) this.tabs.set(key, tab)
        this.emit({ type: "changed" })
    }

    private async add(opened: OpenedPage, window: string) {
        const tab = new Tab(opened, this.browser.capture)
        this.tabs.set(tab.identity, tab)
        this.windowOf.set(tab.identity, window)
        tab.subscribe(event => {
            if (event.type === "video") this.emit({ type: "video", tab: tab.identity, piece: event.piece })
            else if (event.type === "closed") this.remove(tab.identity)
            else this.emit({ type: "changed" })
        })
        // A window that ended before its tab reached it takes the tab with it.
        if (!await this.windows.exists(window)) await tab.close()
        else this.emit({ type: "changed" })
        return tab
    }

    /** A window ended: so do its tabs. */
    private windowEnded(window: string) {
        for (const [identity, owner] of this.windowOf) if (owner === window) void this.tabs.get(identity)?.close().catch(() => undefined)
    }

    private remove(identity: string) {
        this.tabs.delete(identity)
        this.windowOf.delete(identity)
        this.emit({ type: "changed" })
    }

    private entry(tab: Tab): TabEntry {
        return Object.freeze({ ...tab.description(), window: this.windowOf.get(tab.identity)! })
    }

    private emit(event: TabsEvent) {
        for (const listener of this.listeners) listener(event)
    }
}
