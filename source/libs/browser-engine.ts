import {
  chromium,
  type Browser as PlaywrightBrowser,
  type BrowserContext,
  type CDPSession,
  type Page
} from "playwright"
import type { BrowserFrame, BrowserSession, BrowserSnapshot, BrowserViewport } from "@/source/contracts"

export type PageSnapshot = Omit<BrowserSnapshot, "session">
export type PageFrame = Omit<BrowserFrame, "session">
export type PageState = Omit<BrowserSession, "session">
export type FrameListener = (frame: PageFrame) => void

export interface BrowserPage {
  state(): Promise<PageState>
  snapshot(): Promise<PageSnapshot>
  currentFrame(): Promise<PageFrame>
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  resize(viewport: BrowserViewport): Promise<void>
  click(x: number, y: number, button: "left" | "middle" | "right"): Promise<void>
  wheel(deltaX: number, deltaY: number): Promise<void>
  type(text: string): Promise<void>
  press(key: string): Promise<void>
  startFrames(listener: FrameListener): Promise<void>
  stopFrames(): Promise<void>
  close(): Promise<void>
}

export interface BrowserEngine {
  open(viewport: BrowserViewport): Promise<BrowserPage>
  close(): Promise<void>
}

/** One shared Chromium process that creates an isolated context per session. */
export default class ChromiumEngine implements BrowserEngine {
  private browser: Promise<PlaywrightBrowser> | null = null

  public async open(viewport: BrowserViewport) {
    const browser = await this.instance()
    const context = await browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      viewport
    })
    const page = await context.newPage()
    const protocol = await context.newCDPSession(page)

    return new ChromiumPage(context, page, protocol)
  }

  public async close() {
    const browser = this.browser
    this.browser = null
    if (browser) await (await browser).close()
  }

  private instance() {
    this.browser ??= chromium.launch({ headless: true }).catch(error => {
      this.browser = null
      throw error
    })

    return this.browser
  }
}

class ChromiumPage implements BrowserPage {
  private listener: FrameListener | null = null
  private streaming = false
  private sequence = 0
  private title = ""
  private lastFrame = 0

  public constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
    private readonly protocol: CDPSession
  ) {
    protocol.on("Page.screencastFrame", event => {
      void protocol.send("Page.screencastFrameAck", { sessionId: event.sessionId }).catch(() => undefined)

      const viewport = page.viewportSize()
      const listener = this.listener
      const now = performance.now()

      if (!listener || !viewport || now - this.lastFrame < 1000 / 30) return
      this.lastFrame = now

      listener({
        sequence: this.sequence += 1,
        url: page.url(),
        title: this.title,
        image: event.data,
        viewport,
        capturedAt: event.metadata.timestamp ? event.metadata.timestamp * 1_000 : Date.now()
      })
    })
  }

  public async snapshot(): Promise<PageSnapshot> {
    const viewport = this.page.viewportSize()

    if (!viewport) throw new Error("The browser page has no viewport")

    const [image, title] = await Promise.all([
      this.page.screenshot({
        animations: "allow",
        caret: "hide",
        quality: 76,
        type: "jpeg"
      }),
      this.page.title()
    ])

    this.title = title

    return {
      url: this.page.url(),
      title,
      image: image.toString("base64"),
      viewport,
      capturedAt: Date.now()
    }
  }

  public async state(): Promise<PageState> {
    const viewport = this.page.viewportSize()
    if (!viewport) throw new Error("The browser page has no viewport")

    await this.updateTitle()
    return { url: this.page.url(), title: this.title, viewport }
  }

  public async currentFrame(): Promise<PageFrame> {
    return { sequence: this.sequence += 1, ...await this.snapshot() }
  }

  public async navigate(url: string) {
    await this.page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 })
    await this.updateTitle()
  }

  public async back() {
    await this.page.goBack({ waitUntil: "domcontentloaded", timeout: 30_000 })
    await this.updateTitle()
  }

  public async forward() {
    await this.page.goForward({ waitUntil: "domcontentloaded", timeout: 30_000 })
    await this.updateTitle()
  }

  public async reload() {
    await this.page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 })
    await this.updateTitle()
  }

  public async resize(viewport: BrowserViewport) { await this.page.setViewportSize(viewport) }

  public async click(x: number, y: number, button: "left" | "middle" | "right") {
    await this.page.mouse.click(x, y, { button })
  }

  public async wheel(deltaX: number, deltaY: number) { await this.page.mouse.wheel(deltaX, deltaY) }
  public async type(text: string) { await this.page.keyboard.insertText(text) }
  public async press(key: string) { await this.page.keyboard.press(key) }

  public async startFrames(listener: FrameListener) {
    this.listener = listener
    this.lastFrame = 0
    await this.updateTitle()

    if (this.streaming) return

    try {
      await this.protocol.send("Page.startScreencast", {
        format: "jpeg",
        quality: 62,
        maxWidth: 1_920,
        maxHeight: 1_080,
        everyNthFrame: 1
      })
      this.streaming = true
    } catch (error) {
      this.listener = null
      throw error
    }
  }

  public async stopFrames() {
    this.listener = null
    if (!this.streaming) return
    this.streaming = false
    await this.protocol.send("Page.stopScreencast")
  }

  public async close() {
    await this.stopFrames().catch(() => undefined)
    await this.context.close()
  }

  private async updateTitle() {
    this.title = await this.page.title()
  }
}
