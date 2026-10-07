import type Capture from "../capture/capture"
import type { CaptureSize, VideoChunk, VideoStream } from "../capture/capture"

/** A piece of video as it leaves the Server: numbered, so whoever shows it can say how far it got. */
export type VideoPiece = VideoChunk & Readonly<{ sequence: number }>

/** How many pieces may be on their way, not yet shown, before newer ones wait for a key piece. */
const largestLag = 10

/**
 * A tab's video while windows watch it. Capturing starts with the first watcher and stops with the
 * last; a page that changes size is captured anew at its new size. Pieces leave numbered; when the
 * watchers fall too far behind, the pieces in between are dropped and the video resumes from a fresh
 * key piece, so a slow watcher sees the present, late, rather than the past, in order.
 */
export default class Video {
    private readonly watchers = new Map<string, number>()
    private stream: Promise<VideoStream> | null = null
    /** Counts captures, so pieces of one that has ended are not taken for the present one's. */
    private generation = 0
    private sequence = 0
    private waitingForKey = true
    private keyAsked = 0

    public constructor(
        private readonly capture: Capture,
        private readonly tab: number,
        private size: CaptureSize,
        /** Has Chromium draw the page once more, as it is; a still page sends no pictures otherwise. */
        private readonly repaint: () => Promise<void>,
        private readonly send: (piece: VideoPiece) => void
    ) {}

    /** A watcher starts showing the video; it begins at a key piece. */
    public watch(watcher: string) {
        this.watchers.set(watcher, this.sequence)
        this.waitingForKey = true
        this.keyAsked = 0
        if (this.stream) this.askForKey()
        else this.stream = this.open(null)
        return this.stream.then(() => undefined)
    }

    public unwatch(watcher: string) {
        if (!this.watchers.delete(watcher) || this.watchers.size > 0) return
        this.generation++
        const stream = this.stream
        this.stream = null
        void stream?.then(stream => stream.close()).catch(() => undefined)
    }

    /** The page has a new size: while watched, it is captured anew at that size, from a key piece. */
    public resize(size: CaptureSize) {
        if (size.width === this.size.width && size.height === this.size.height) return
        this.size = size
        if (!this.stream) return
        this.waitingForKey = true
        this.stream = this.open(this.stream)
    }

    /** A watcher has shown every piece up to this one. */
    public acknowledge(watcher: string, sequence: number) {
        if (!this.watchers.has(watcher)) return
        this.watchers.set(watcher, Math.max(this.watchers.get(watcher)!, sequence))
        // Caught up after falling behind: a still page sends nothing more, so the key piece is asked for.
        if (this.waitingForKey && this.lag() <= largestLag) this.askForKey()
    }

    public close() {
        for (const watcher of [...this.watchers.keys()]) this.unwatch(watcher)
    }

    /** Captures at the present size, once the capture before, if any, has ended and freed the tab. */
    private open(before: Promise<VideoStream> | null): Promise<VideoStream> {
        const generation = ++this.generation
        const opened = (async () => {
            if (before) await before.then(stream => stream.close()).catch(() => undefined)
            const stream = await this.capture.stream(this.tab, this.size, chunk => { if (generation === this.generation) this.received(chunk) })
            // A new capture begins with the page as it is, even when nothing on it moves.
            await this.repaint().catch(() => undefined)
            return stream
        })()
        opened.catch(() => { if (generation === this.generation) this.stream = null })
        return opened
    }

    private received(chunk: VideoChunk) {
        if (this.lag() > largestLag) {
            this.waitingForKey = true
            return
        }
        if (this.waitingForKey && !chunk.key) return this.askForKey()
        this.waitingForKey = false
        this.send({ ...chunk, sequence: ++this.sequence })
    }

    /** Asks for a key piece, at most a few times a second while one is on its way. */
    private askForKey() {
        const now = Date.now()
        if (now - this.keyAsked < 250) return
        this.keyAsked = now
        void this.stream?.then(stream => stream.key()).catch(() => undefined)
    }

    /** How far the slowest watcher is behind the newest piece sent. */
    private lag() {
        let lag = 0
        for (const shown of this.watchers.values()) lag = Math.max(lag, this.sequence - shown)
        return lag
    }
}
