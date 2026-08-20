import type { BrowserFrame } from "@/source/contracts"

/** Keeps high-frequency frames outside React state and drops superseded work at the renderer. */
export default class BrowserFrames {
  private readonly listeners = new Set<(frame: BrowserFrame) => void>()
  private latest: BrowserFrame | null

  public constructor(frame: BrowserFrame | null = null) {
    this.latest = frame
  }

  public publish(frame: BrowserFrame) {
    this.latest = frame
    for (const listener of this.listeners) listener(frame)
  }

  public subscribe(listener: (frame: BrowserFrame) => void) {
    this.listeners.add(listener)
    if (this.latest) listener(this.latest)
    return () => this.listeners.delete(listener)
  }
}
