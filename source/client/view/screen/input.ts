import type { KeyInput, PointerInput } from "@client/core/flambo"

type Send = Readonly<{ pointer(input: PointerInput): Promise<void>, key(input: KeyInput): Promise<void>, insert(text: string): Promise<void> }>

type Entry =
    | Readonly<{ kind: "pointer", input: PointerInput }>
    | Readonly<{ kind: "key", input: KeyInput }>
    | Readonly<{ kind: "insert", text: string }>

/** The machine the window runs on uses Meta for shortcuts, as macOS does. */
const metaForShortcuts = /Mac|iPhone|iPad/.test(navigator.platform)

/**
 * Input on its way to a tab, one at a time and in the order it happened. Moves and wheel turns that
 * pile up while an earlier input is on its way are merged into one, so the page follows the pointer
 * closely instead of replaying its path late.
 */
export default class InputLine {
    private readonly waiting: Entry[] = []
    private readonly held = new Set<string>()
    private sending = false

    public constructor(private readonly send: Send) {}

    public pointer(input: PointerInput) {
        const last = this.waiting.at(-1)
        if (last?.kind === "pointer" && last.input.type === "move" && input.type === "move") this.waiting[this.waiting.length - 1] = { kind: "pointer", input }
        else if (last?.kind === "pointer" && last.input.type === "wheel" && input.type === "wheel")
            this.waiting[this.waiting.length - 1] = { kind: "pointer", input: { ...input, deltaX: last.input.deltaX + input.deltaX, deltaY: last.input.deltaY + input.deltaY } }
        else this.waiting.push({ kind: "pointer", input })
        this.next()
    }

    /** A key as the DOM names it; the key that holds shortcuts here becomes the one that holds them there. */
    public key(type: KeyInput["type"], key: string) {
        const named = key === (metaForShortcuts ? "Meta" : "Control") ? "ControlOrMeta" : key
        if (type === "down") this.held.add(named)
        else if (!this.held.delete(named)) return
        this.waiting.push({ kind: "key", input: { type, key: named } })
        this.next()
    }

    public insert(text: string) {
        this.waiting.push({ kind: "insert", text })
        this.next()
    }

    /** The window lost the keyboard: every key it still holds is let go, so none stays pressed. */
    public releaseKeys() {
        for (const key of [...this.held]) this.key("up", key)
    }

    private next() {
        if (this.sending) return
        const entry = this.waiting.shift()
        if (!entry) return
        this.sending = true
        const sent = entry.kind === "pointer" ? this.send.pointer(entry.input) : entry.kind === "key" ? this.send.key(entry.input) : this.send.insert(entry.text)
        void sent.catch(() => undefined).finally(() => {
            this.sending = false
            this.next()
        })
    }
}
