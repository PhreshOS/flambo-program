import { chromium, type Browser, type BrowserContext as PlaywrightContext, type Disposable, type Page, type Request } from "playwright"
import type { BrowserContext, BrowserEngine, BrowserFrame, BrowserPage } from "./browser-engine"
import { maximumViewportDimension, type KeyModifiers, type PointerButton, type Viewport } from "../../shared/flambo"

const frameQuality = 90

/** Chromium implementation of the browser domain's execution contract. */
export default class ChromiumEngine implements BrowserEngine {
  private browser: Promise<Browser> | null = null

  public async createWorkspace(): Promise<BrowserContext> {
    const browser = await this.runningBrowser()
    return new ChromiumContext(await browser.newContext())
  }

  public async close() {
    const browser = this.browser
    this.browser = null
    if (browser) await (await browser).close()
  }

  private runningBrowser() {
    this.browser ??= chromium.launch({ headless: true }).catch(error => {
      this.browser = null
      throw error
    })
    return this.browser
  }
}

class ChromiumContext implements BrowserContext {
  public constructor(private readonly context: PlaywrightContext) {}

  public async open(viewport: Viewport) {
    const page = await this.context.newPage()

    try {
      await page.setViewportSize(viewport)
      return new ChromiumPage(this.context, page)
    } catch (error) {
      await page.close().catch(() => undefined)
      throw error
    }
  }

  public async close() { await this.context.close() }
}

class ChromiumPage implements BrowserPage {
  private readonly frameListeners = new Set<(frame: BrowserFrame) => unknown>()
  private readonly stateListeners = new Set<() => unknown>()
  private readonly loadingListeners = new Set<(loading: boolean) => unknown>()
  private screencast: Promise<Disposable> | null = null
  private activeNavigation: Request | null = null
  private loading = false
  private favicon: string | null = null
  private faviconGeneration = 0
  private faviconLoading: Promise<void> | null = null
  private readonly stateChanged = () => {
    for (const listener of this.stateListeners) listener()
  }
  private readonly frameNavigated = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame !== this.page.mainFrame()) return
    // History API navigation also emits framenavigated, but it keeps the same
    // document and its favicon. Only a document navigation may invalidate it.
    this.stateChanged()
  }
  private readonly contentLoaded = () => {
    this.stateChanged()
    void this.refreshFavicon()
  }
  private readonly navigationStarted = (request: Request) => {
    if (!request.isNavigationRequest() || request.frame() !== this.page.mainFrame()) return
    this.activeNavigation = request
    this.resetFavicon()
    this.setLoading(true)
  }
  private readonly navigationFailed = (request: Request) => {
    if (request !== this.activeNavigation) return
    this.activeNavigation = null
    this.setLoading(false)
  }
  private readonly navigationLoaded = () => {
    this.activeNavigation = null
    this.setLoading(false)
    this.stateChanged()
    void this.refreshFavicon()
  }

  public constructor(private readonly context: PlaywrightContext, private readonly page: Page) {
    page.on("framenavigated", this.frameNavigated)
    page.on("domcontentloaded", this.contentLoaded)
    page.on("request", this.navigationStarted)
    page.on("requestfailed", this.navigationFailed)
    page.on("load", this.navigationLoaded)
  }

  public async state() {
    const viewport = this.page.viewportSize()
    if (!viewport) throw new Error("Chromium returned no viewport for the Flambo Tab")
    // Chromium's navigation history is authoritative for both back and forward;
    // deriving only from URLs cannot distinguish a forward entry after going back.
    const history = await (async () => {
      const session = await this.context.newCDPSession(this.page)
      try {
        // A CDP session is attached to the page target that exists at that
        // moment. Keeping it for the Tab lifetime lets a later target handoff
        // turn every history read into "Not attached to an active page".
        return await session.send("Page.getNavigationHistory")
      } finally {
        await session.detach().catch(() => undefined)
      }
    })()
    const title = await this.page.title()
    return {
      url: this.page.url(),
      title,
      favicon: this.favicon,
      loading: this.loading,
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      viewport
    }
  }

  public async capture() {
    return new Uint8Array(await this.page.screenshot({ type: "jpeg", quality: frameQuality }))
  }

  public observeState(listener: () => unknown) {
    this.stateListeners.add(listener)
    return () => { this.stateListeners.delete(listener) }
  }

  public observeLoading(listener: (loading: boolean) => unknown) {
    this.loadingListeners.add(listener)
    return () => { this.loadingListeners.delete(listener) }
  }

  public async observeFrames(listener: (frame: BrowserFrame) => unknown) {
    this.frameListeners.add(listener)
    await this.startScreencast()
    let observing = true

    return () => {
      if (!observing) return
      observing = false
      this.frameListeners.delete(listener)
      if (this.frameListeners.size === 0) void this.stopScreencast()
    }
  }

  public async navigate(url: string) {
    this.resetFavicon()
    await this.page.goto(url, { waitUntil: "domcontentloaded" })
  }
  public async back() {
    this.resetFavicon()
    await this.page.goBack({ waitUntil: "domcontentloaded" })
  }
  public async forward() {
    this.resetFavicon()
    await this.page.goForward({ waitUntil: "domcontentloaded" })
  }
  public async reload() {
    this.resetFavicon()
    await this.page.reload({ waitUntil: "domcontentloaded" })
  }
  public async resize(viewport: Viewport) { await this.page.setViewportSize(viewport) }
  public async movePointer(x: number, y: number) { await this.page.mouse.move(x, y) }
  public async click(x: number, y: number, button: PointerButton) { await this.page.mouse.click(x, y, { button }) }
  public async wheel(deltaX: number, deltaY: number) { await this.page.mouse.wheel(deltaX, deltaY) }
  public async type(text: string) { await this.page.keyboard.insertText(text) }
  public async press(key: string, modifiers: KeyModifiers) {
    await this.page.keyboard.press([...modifiers, key].join("+"))
  }
  public async close() {
    this.frameListeners.clear()
    this.stateListeners.clear()
    this.loadingListeners.clear()
    this.page.off("framenavigated", this.frameNavigated)
    this.page.off("domcontentloaded", this.contentLoaded)
    this.page.off("request", this.navigationStarted)
    this.page.off("requestfailed", this.navigationFailed)
    this.page.off("load", this.navigationLoaded)
    await this.stopScreencast()
    await this.page.close()
  }

  private setLoading(loading: boolean) {
    if (this.loading === loading) return
    this.loading = loading
    for (const listener of this.loadingListeners) listener(loading)
  }

  private resetFavicon() {
    this.faviconGeneration += 1
    this.favicon = null
    this.faviconLoading = null
  }

  private refreshFavicon() {
    if (this.faviconLoading) return this.faviconLoading
    const generation = this.faviconGeneration
    const loading = this.readFavicon().then(favicon => {
      if (generation !== this.faviconGeneration || favicon === this.favicon) return
      this.favicon = favicon
      this.stateChanged()
    }).catch(() => undefined).finally(() => {
      if (this.faviconLoading === loading) this.faviconLoading = null
    })
    this.faviconLoading = loading
    return loading
  }

  private async readFavicon() {
    const candidates = await this.page.evaluate(() => {
      const declared = [...document.querySelectorAll<HTMLLinkElement>("link[rel]")]
        .find(link => link.rel.toLowerCase().split(/\s+/).includes("icon"))?.href
      const location = new URL(document.location.href)
      const fallback = location.protocol === "http:" || location.protocol === "https:"
        ? new URL("/favicon.ico", location).href
        : null
      return [...new Set([declared, fallback].filter((value): value is string => !!value))]
    })

    for (const candidate of candidates) {
      if (candidate.startsWith("data:image/")) return candidate
      if (!candidate.startsWith("http://") && !candidate.startsWith("https://")) continue
      try {
        const response = await this.context.request.get(candidate, { failOnStatusCode: false, timeout: 5_000 })
        if (!response.ok()) continue
        const mimeType = response.headers()["content-type"]?.split(";", 1)[0]?.trim()
        if (!mimeType?.startsWith("image/")) continue
        const data = await response.body()
        if (data.byteLength > 1_048_576) continue
        return `data:${mimeType};base64,${data.toString("base64")}`
      } catch {
        continue
      }
    }
    return null
  }

  private async startScreencast() {
    this.screencast ??= this.page.screencast.start({
      // Playwright otherwise caps the longest frame edge at 800 pixels. The
      // domain maximum is only an upper bound; Chromium keeps smaller pages at
      // their native viewport size and therefore preserves resize fidelity.
      size: { width: maximumViewportDimension, height: maximumViewportDimension },
      quality: frameQuality,
      onFrame: frame => {
        const value = Object.freeze({
          viewport: Object.freeze({ width: frame.viewportWidth, height: frame.viewportHeight }),
          data: new Uint8Array(frame.data)
        })
        for (const listener of this.frameListeners) listener(value)
      }
    }).catch(error => {
      this.screencast = null
      throw error
    })
    await this.screencast
  }

  private async stopScreencast() {
    const screencast = this.screencast
    this.screencast = null
    if (screencast) await (await screencast).dispose().catch(() => undefined)
  }
}
