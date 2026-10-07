import { tab as tabOf, type VideoPiece } from "@client/core/flambo"
import { Surface, usePreferences } from "@phreshos/react-ui"
import { useEffect, useRef } from "react"
import { videoCodec } from "@shared/video"
import InputLine from "./input"

/** How often a window tells the Server how far it has shown the video. */
const acknowledgeEvery = 50

/** How long a window waits for its size to settle before the page takes it. */
const resizeAfter = 80

const buttons = ["left", "middle", "right"] as const

/**
 * One tab's page, drawn from its video on a well recessed into the window. The page takes the size of
 * the well, in the screen's own pixels, so it is drawn sharp. Pointer, wheel, and keys go to the page
 * in the order they happen; text pasted into the window is typed into it.
 */
export default function Screen({ tab, onDrawn }: Readonly<{ tab: string, onDrawn?: () => void }>) {
    const well = useRef<HTMLDivElement>(null)
    const canvas = useRef<HTMLCanvasElement>(null)
    const onDrawnOf = useRef(onDrawn)
    onDrawnOf.current = onDrawn
    const { theme } = usePreferences()

    // The page follows the Desktop's theme, as pages follow a system's own.
    useEffect(() => { void tabOf(tab).scheme(theme).catch(() => undefined) }, [tab, theme])

    // The video: decoded as it arrives and drawn at once, one device pixel to one screen pixel.
    useEffect(() => {
        const current = tabOf(tab)
        const surface = canvas.current!
        const painter = surface.getContext("2d", { alpha: false, desynchronized: true })!
        let active = true
        let drawn = 0
        let acknowledged = 0
        let acknowledgeTimer: ReturnType<typeof setTimeout> | undefined
        let stop: (() => void) | undefined
        let decoder: VideoDecoder
        let waitingForKey = true
        const sequences: number[] = []

        const acknowledge = () => {
            acknowledgeTimer = undefined
            if (!active || drawn === acknowledged) return
            acknowledged = drawn
            void current.acknowledge(drawn).catch(() => undefined)
        }

        const draw = (frame: VideoFrame) => {
            const sequence = sequences.shift() ?? drawn
            if (!active) return frame.close()
            if (surface.width !== frame.displayWidth || surface.height !== frame.displayHeight) {
                surface.width = frame.displayWidth
                surface.height = frame.displayHeight
                surface.style.width = `${frame.displayWidth / devicePixelRatio}px`
                surface.style.height = `${frame.displayHeight / devicePixelRatio}px`
            }
            painter.drawImage(frame, 0, 0)
            frame.close()
            if (drawn === 0) onDrawnOf.current?.()
            drawn = sequence
            acknowledgeTimer ??= setTimeout(acknowledge, acknowledgeEvery)
        }

        const start = () => {
            decoder = new VideoDecoder({ output: draw, error: () => { if (active) restart() } })
            decoder.configure({ codec: videoCodec, optimizeForLatency: true })
            waitingForKey = true
            sequences.length = 0
            void current.watch(receive).then(
                watching => { if (active) stop = watching; else watching() },
                () => undefined
            )
        }

        // A piece that could not be decoded breaks every later one: the video starts again from a key piece.
        const restart = () => {
            stop?.()
            stop = undefined
            if (decoder.state !== "closed") decoder.close()
            start()
        }

        const receive = (piece: VideoPiece) => {
            if (!active || decoder.state !== "configured") return
            if (waitingForKey && !piece.key) return
            waitingForKey = false
            sequences.push(piece.sequence)
            decoder.decode(new EncodedVideoChunk({ type: piece.key ? "key" : "delta", timestamp: piece.timestamp, data: piece.data }))
        }

        start()
        return () => {
            active = false
            clearTimeout(acknowledgeTimer)
            stop?.()
            if (decoder.state !== "closed") decoder.close()
        }
    }, [tab])

    // The page takes the well's size, in CSS pixels, and the screen's pixel ratio, once it settles.
    useEffect(() => {
        const current = tabOf(tab)
        const host = well.current!
        let timer: ReturnType<typeof setTimeout> | undefined
        let last = ""
        const apply = () => {
            const width = Math.max(1, Math.floor(host.clientWidth))
            const height = Math.max(1, Math.floor(host.clientHeight))
            const viewport = { width, height, scale: devicePixelRatio }
            const key = JSON.stringify(viewport)
            if (key === last) return
            last = key
            void current.resize(viewport).catch(() => undefined)
        }
        apply()
        const observer = new ResizeObserver(() => {
            clearTimeout(timer)
            timer = setTimeout(apply, resizeAfter)
        })
        observer.observe(host)
        return () => {
            observer.disconnect()
            clearTimeout(timer)
        }
    }, [tab])

    // Input: in order, merged when it piles up, and let go when the window loses the keyboard.
    useEffect(() => {
        const current = tabOf(tab)
        const surface = canvas.current!
        const line = new InputLine(current)
        const point = (event: { clientX: number, clientY: number }) => {
            const box = surface.getBoundingClientRect()
            return { x: event.clientX - box.left, y: event.clientY - box.top }
        }
        const pointerMove = (event: PointerEvent) => line.pointer({ type: "move", ...point(event) })
        const pointerDown = (event: PointerEvent) => {
            const button = buttons[event.button]
            if (!button) return
            surface.focus()
            surface.setPointerCapture(event.pointerId)
            line.pointer({ type: "down", ...point(event), button, clickCount: Math.min(3, Math.max(1, event.detail)) })
        }
        const pointerUp = (event: PointerEvent) => {
            const button = buttons[event.button]
            if (!button) return
            line.pointer({ type: "up", ...point(event), button, clickCount: Math.min(3, Math.max(1, event.detail)) })
        }
        const wheel = (event: WheelEvent) => {
            event.preventDefault()
            const scale = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? surface.clientHeight : 1
            line.pointer({ type: "wheel", ...point(event), deltaX: event.deltaX * scale, deltaY: event.deltaY * scale })
        }
        const key = (event: KeyboardEvent) => {
            // Pasting is left to the window, which receives the text and types it into the page.
            if (event.type === "keydown" && event.key === "v" && (event.metaKey || event.ctrlKey)) return
            event.preventDefault()
            if (event.isComposing) return
            line.key(event.type === "keydown" ? "down" : "up", event.key)
        }
        const paste = (event: ClipboardEvent) => {
            event.preventDefault()
            const text = event.clipboardData?.getData("text/plain")
            if (text) line.insert(text)
        }
        const composed = (event: CompositionEvent) => { if (event.data) line.insert(event.data) }
        const blur = () => line.releaseKeys()
        const menu = (event: Event) => event.preventDefault()
        surface.addEventListener("pointermove", pointerMove)
        surface.addEventListener("pointerdown", pointerDown)
        surface.addEventListener("pointerup", pointerUp)
        surface.addEventListener("wheel", wheel, { passive: false })
        surface.addEventListener("keydown", key)
        surface.addEventListener("keyup", key)
        surface.addEventListener("paste", paste)
        surface.addEventListener("compositionend", composed)
        surface.addEventListener("blur", blur)
        surface.addEventListener("contextmenu", menu)
        return () => {
            line.releaseKeys()
            surface.removeEventListener("pointermove", pointerMove)
            surface.removeEventListener("pointerdown", pointerDown)
            surface.removeEventListener("pointerup", pointerUp)
            surface.removeEventListener("wheel", wheel)
            surface.removeEventListener("keydown", key)
            surface.removeEventListener("keyup", key)
            surface.removeEventListener("paste", paste)
            surface.removeEventListener("compositionend", composed)
            surface.removeEventListener("blur", blur)
            surface.removeEventListener("contextmenu", menu)
        }
    }, [tab])

    return <Surface ref={well} depth="recessed" className="screen">
        <canvas ref={canvas} className="screen-page" tabIndex={0} aria-label="Page" />
    </Surface>
}
