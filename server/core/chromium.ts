import { chromium, type Browser, type BrowserContext as PlaywrightContext, type CDPSession, type Disposable, type Page } from "playwright"
import type { BrowserContext, BrowserEngine, BrowserFrame, BrowserPage } from "./browser-engine"
import type { KeyModifiers, PointerButton, Viewport } from "../../shared/browser"

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
      return new ChromiumPage(page, await this.context.newCDPSession(page))
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
  private screencast: Promise<Disposable> | null = null
  private readonly stateChanged = () => {
    for (const listener of this.stateListeners) listener()
  }
  private readonly frameNavigated = (frame: ReturnType<Page["mainFrame"]>) => {
    if (frame === this.page.mainFrame()) this.stateChanged()
  }

  public constructor(private readonly page: Page, private readonly session: CDPSession) {
    page.on("framenavigated", this.frameNavigated)
    page.on("domcontentloaded", this.stateChanged)
    page.on("load", this.stateChanged)
  }

  public async state() {
    const viewport = this.page.viewportSize()
    if (!viewport) throw new Error("Chromium returned no viewport for the browser Tab")
    // Chromium's navigation history is authoritative for both back and forward;
    // deriving only from URLs cannot distinguish a forward entry after going back.
    const [title, history] = await Promise.all([
      this.page.title(),
      this.session.send("Page.getNavigationHistory")
    ])
    return {
      url: this.page.url(),
      title,
      canGoBack: history.currentIndex > 0,
      canGoForward: history.currentIndex < history.entries.length - 1,
      viewport
    }
  }

  public async capture() {
    return new Uint8Array(await this.page.screenshot({ type: "jpeg", quality: 80 }))
  }

  public observeState(listener: () => unknown) {
    this.stateListeners.add(listener)
    return () => { this.stateListeners.delete(listener) }
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

  public async navigate(url: string) { await this.page.goto(url, { waitUntil: "domcontentloaded" }) }
  public async back() { await this.page.goBack({ waitUntil: "domcontentloaded" }) }
  public async forward() { await this.page.goForward({ waitUntil: "domcontentloaded" }) }
  public async reload() { await this.page.reload({ waitUntil: "domcontentloaded" }) }
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
    this.page.off("framenavigated", this.frameNavigated)
    this.page.off("domcontentloaded", this.stateChanged)
    this.page.off("load", this.stateChanged)
    await this.stopScreencast()
    await this.session.detach().catch(() => undefined)
    await this.page.close()
  }

  private async startScreencast() {
    this.screencast ??= this.page.screencast.start({
      quality: 80,
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
