import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type WheelEvent } from "react"
import type { BrowserTab } from "@client/core/use-browser"
import type BrowserFrames from "@client/core/browser-frames"
import type { BrowserFrame, BrowserKeyRequest, BrowserViewport } from "@/source/contracts"
import NewTabPage from "./new-tab-page"
import { IconReload, IconBack, IconSearch } from "./icons"

type SurfaceProperties = Readonly<{
  tab: BrowserTab | undefined
  navigate(url: string): void
  reload(): void
  back(): void
  click(x: number, y: number, button: "left" | "middle" | "right"): void
  wheel(deltaX: number, deltaY: number): void
  type(text: string): void
  press(key: string, modifiers: BrowserKeyRequest["modifiers"]): void
  resize(viewport: BrowserViewport): void
}>

export default function Surface({
  tab,
  navigate,
  reload,
  back,
  click,
  wheel,
  type,
  press,
  resize
}: SurfaceProperties) {
  const element = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [displayedFrames, setDisplayedFrames] = useState<BrowserFrames | null>(null)

  const isBlank = !tab || !tab.page.url || tab.page.url === "about:blank"
  const frameDisplayed = Boolean(tab?.frames && displayedFrames === tab.frames)

  useEffect(() => {
    const target = element.current
    if (!target || !tab) return

    let timer = 0
    const observer = new ResizeObserver(entries => {
      const size = entries[0]?.contentRect
      if (!size) return

      window.clearTimeout(timer)
      timer = window.setTimeout(() => resize({
        width: Math.max(240, Math.min(1_920, Math.round(size.width))),
        height: Math.max(160, Math.min(1_080, Math.round(size.height)))
      }), 120)
    })

    observer.observe(target)

    return () => {
      window.clearTimeout(timer)
      observer.disconnect()
    }
  }, [tab?.session, resize])

  useEffect(() => {
    const target = canvas.current
    const frames = tab?.frames
    if (!target || !frames || isBlank) return

    let live = true
    let decoding = false
    let pending: BrowserFrame | null = null

    const draw = () => {
      if (!live || decoding || !pending) return

      const frame = pending
      pending = null
      decoding = true

      const image = new Image()
      image.decoding = "async"
      image.onload = () => {
        if (live) {
          if (target.width !== frame.viewport.width) target.width = frame.viewport.width
          if (target.height !== frame.viewport.height) target.height = frame.viewport.height
          const context = target.getContext("2d", { alpha: false })

          if (context) {
            context.drawImage(image, 0, 0, target.width, target.height)
            setDisplayedFrames(frames)
          }
        }

        decoding = false
        draw()
      }
      image.onerror = () => {
        decoding = false
        draw()
      }
      image.src = `data:image/jpeg;base64,${frame.image}`
    }

    const unsubscribe = frames.subscribe(frame => {
      pending = frame
      draw()
    })

    return () => {
      live = false
      pending = null
      unsubscribe()
    }
  }, [tab?.frames, isBlank])

  function mouse(event: MouseEvent<HTMLDivElement>) {
    if (!tab || isBlank) return
    const rectangle = event.currentTarget.getBoundingClientRect()
    const x = (event.clientX - rectangle.left) / rectangle.width * tab.page.viewport.width
    const y = (event.clientY - rectangle.top) / rectangle.height * tab.page.viewport.height
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"

    event.currentTarget.focus()
    click(x, y, button)
  }

  function scroll(event: WheelEvent<HTMLDivElement>) {
    if (isBlank) return
    wheel(event.deltaX, event.deltaY)
  }

  function keyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (isBlank) return
    const modifiers: NonNullable<BrowserKeyRequest["modifiers"]> = [
      ...event.altKey ? ["Alt" as const] : [],
      ...event.ctrlKey ? ["Control" as const] : [],
      ...event.metaKey ? ["Meta" as const] : [],
      ...event.shiftKey ? ["Shift" as const] : []
    ]

    event.preventDefault()

    if (event.key.length === 1 && !event.altKey && !event.ctrlKey && !event.metaKey) type(event.key)
    else press(event.key, modifiers)
  }

  return (
    <div
      className={`surface ${isBlank ? "is-blank" : ""}`}
      ref={element}
      role="application"
      aria-label="Browser page"
      tabIndex={0}
      onContextMenu={event => event.preventDefault()}
      onMouseDown={mouse}
      onWheel={scroll}
      onKeyDown={keyboard}
    >
      {isBlank ? (
        <NewTabPage navigate={navigate} />
      ) : (
        <>
          <canvas ref={canvas} aria-hidden="true" />
          {!frameDisplayed && (
            <div className="surface-loading" role="status" aria-label="Loading page">
              <div className="loading-spinner-large" />
            </div>
          )}
        </>
      )}

      {tab?.error && (
        <div className="page-error-card" role="alert">
          <div className="error-header">
            <span className="error-icon">⚠️</span>
            <h3>Navigation Error</h3>
          </div>
          <p className="error-message">{tab.error}</p>
          <div className="error-actions">
            <button type="button" className="error-button primary" onClick={reload}>
              <IconReload /> Retry
            </button>
            <button type="button" className="error-button" onClick={back}>
              <IconBack /> Go Back
            </button>
            <button
              type="button"
              className="error-button"
              onClick={() => navigate(`https://duckduckgo.com/?q=${encodeURIComponent(tab.page.url)}`)}
            >
              <IconSearch /> Search
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
