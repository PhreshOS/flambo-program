import type { BrowserFrame, BrowserSession, BrowserSnapshot, BrowserViewport } from "./browser"

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
