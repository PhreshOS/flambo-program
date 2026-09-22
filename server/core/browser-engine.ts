import type { KeyModifiers, PageState, PointerButton, Viewport } from "../../shared/browser"

export type BrowserFrame = Readonly<{
  viewport: Viewport
  data: Uint8Array
}>

export interface BrowserPage {
  state(): Promise<PageState>
  observeState(listener: () => unknown): () => void
  capture(): Promise<Uint8Array>
  observeFrames(listener: (frame: BrowserFrame) => unknown): Promise<() => void>
  navigate(url: string): Promise<void>
  back(): Promise<void>
  forward(): Promise<void>
  reload(): Promise<void>
  resize(viewport: Viewport): Promise<void>
  movePointer(x: number, y: number): Promise<void>
  click(x: number, y: number, button: PointerButton): Promise<void>
  wheel(deltaX: number, deltaY: number): Promise<void>
  type(text: string): Promise<void>
  press(key: string, modifiers: KeyModifiers): Promise<void>
  close(): Promise<void>
}

export interface BrowserContext {
  open(viewport: Viewport): Promise<BrowserPage>
  close(): Promise<void>
}

export interface BrowserEngine {
  createWorkspace(): Promise<BrowserContext>
  close(): Promise<void>
}
