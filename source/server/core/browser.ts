import { chromium, type BrowserContext, type Page } from "playwright"
import { join } from "node:path"
import { execFileSync } from "node:child_process"
import Capture, { placeExtension } from "./capture/capture"

/** A page Chromium shows, with the tab it shows it in and a direct line to it. */
export type OpenedPage = Readonly<{ page: Page, tab: number, session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> }>

/**
 * Chromium on this machine, with the capture extension and a profile that keeps what a person signs
 * into. Pages are given their size by Flambo, not by Playwright, so Chromium itself has none. Both the
 * profile and the extension live in the folder Flambo is given.
 */
export default class Browser {
    private constructor(private readonly context: BrowserContext, public readonly capture: Capture) {}

    public static async launch(folder: string) {
        const extension = await placeExtension(folder)
        const context = await chromium.launchPersistentContext(join(folder, "profile"), {
            channel: "chromium",
            headless: true,
            viewport: null,
            // Pages are opened for a person, so the browser presents itself as the Chrome it is, not as
            // an automated or headless one; sites that turn automation away show their pages instead.
            ignoreDefaultArgs: ["--enable-automation"],
            userAgent: userAgent(),
            args: [
                "--disable-blink-features=AutomationControlled",
                `--disable-extensions-except=${extension.folder}`,
                `--load-extension=${extension.folder}`,
                // The extension captures tabs without a person choosing them, which this flag allows.
                `--allowlisted-extension-id=${extension.identity}`,
                "--auto-accept-this-tab-capture"
            ]
        })
        try {
            const isExtension = (worker: { url(): string }) => worker.url().startsWith(`chrome-extension://${extension.identity}/`)
            const worker = context.serviceWorkers().find(isExtension) ?? await context.waitForEvent("serviceworker", { predicate: isExtension, timeout: 15_000 })
            // A persistent profile opens with a blank page that no one asked for.
            for (const page of context.pages()) await page.close()
            return new Browser(context, await Capture.connect(worker))
        }
        catch (error) {
            await context.close()
            throw error
        }
    }

    /** Opens a new page in its own tab. */
    public async open(): Promise<OpenedPage> {
        return await this.opened(await this.context.newPage())
    }

    /** Follows pages that pages open themselves, such as links that open in a new tab. */
    public followPopups(popup: (opened: OpenedPage, opener: Page) => void) {
        this.context.on("page", page => {
            void page.opener().then(async opener => { if (opener) popup(await this.opened(page), opener) }).catch(() => undefined)
        })
    }

    /** The places on the web visited most, at most this many, for a new tab to offer. */
    public async sites(limit: number) {
        return await this.capture.sites(limit)
    }

    public async close() {
        this.capture.close()
        await this.context.close()
    }

    private async opened(page: Page): Promise<OpenedPage> {
        const session = await this.context.newCDPSession(page)
        const { targetInfo } = await session.send("Target.getTargetInfo")
        return { page, session, tab: await this.capture.tab(targetInfo.targetId) }
    }
}

/**
 * What Chrome itself would send on this system, at the version Flambo runs: the reduced form every
 * Chrome sends, with the major version only, and without the "Headless" a headless Chromium adds.
 */
function userAgent() {
    const major = execFileSync(chromium.executablePath(), ["--version"], { encoding: "utf8" }).match(/(\d+)\./)?.[1] ?? "140"
    const system = process.platform === "darwin" ? "Macintosh; Intel Mac OS X 10_15_7"
        : process.platform === "win32" ? "Windows NT 10.0; Win64; x64"
        : "X11; Linux x86_64"
    return `Mozilla/5.0 (${system}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36`
}
