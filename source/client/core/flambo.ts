import { context } from "@phreshos/client"
import type { Process, ServerEndpoint } from "@phreshos/core"
import type { KeyInput, PointerInput, Viewport, VideoPiece } from "@server/core/tab/tab"
import type { TabEntry } from "@server/core/tabs"
import type { Site } from "@server/core/capture/capture"
import { videoEvent } from "@shared/events"
import { flamboService } from "@shared/service"

export type { KeyInput, PointerInput, Site, TabEntry, Viewport, VideoPiece }

type Shared = Readonly<{ process: Process, server: ServerEndpoint }>

let shared: Promise<Shared> | undefined

const listFollowers = new Set<(tabs: readonly TabEntry[]) => void>()

/** The one Server every window uses, the "flambo" Service; a window that finds it gone starts it again. */
function server() {
    shared ??= (async () => {
        const program = await context.program()
        const process = await program.findOrCreateProcess({ name: flamboService, server: true, client: false })
        await process.server.waitReady()
        process.server.subscribe("tabs.changed", payload => { for (const follow of listFollowers) follow(payload as readonly TabEntry[]) })
        return { process, server: process.server }
    })().catch(error => { shared = undefined; throw error })
    return shared
}

/** Asks the Server; when its Process has ended since, finds or starts it again and asks once more. */
async function ask<Result>(event: string, payload?: unknown): Promise<Result> {
    for (let attempt = 0; ; attempt++) {
        const current = await server()
        try {
            return await current.server.timeout(15_000).ask<Result>(event, payload)
        }
        catch (error) {
            const ended = await current.process.exited().catch(() => true)
            if (attempt > 0 || !ended) throw error
            shared = undefined
        }
    }
}

/** This window's own identity, which the Server knows it by. */
export const windowIdentity = context.process().then(process => process.identity)

/** Every tab, of every window. */
export function listTabs() {
    return ask<readonly TabEntry[]>("tabs.list")
}

/** Follows the list of tabs as it changes. */
export function followTabs(follow: (tabs: readonly TabEntry[]) => void) {
    listFollowers.add(follow)
    void server().catch(() => undefined)
    return () => { listFollowers.delete(follow) }
}

/** The places on the web visited most, for a new tab to offer. */
export function listSites() {
    return ask<readonly Site[]>("sites.list")
}

/** Opens a tab in this window, at an address or blank. */
export async function createTab(address?: string) {
    return await ask<TabEntry>("tab.create", { window: await windowIdentity, ...(address ? { address } : {}) })
}

/** One tab, as a window uses it. */
export function tab(identity: string) {
    const payload = { tab: identity }
    return {
        close: () => ask<void>("tab.close", payload),
        navigate: (address: string) => ask<void>("tab.navigate", { ...payload, address }),
        back: () => ask<void>("tab.back", payload),
        forward: () => ask<void>("tab.forward", payload),
        reload: () => ask<void>("tab.reload", payload),
        resize: (viewport: Viewport) => ask<void>("tab.resize", { ...payload, ...viewport }),
        scheme: (theme: "light" | "dark") => ask<void>("tab.scheme", { ...payload, theme }),
        pointer: (input: PointerInput) => ask<void>("tab.pointer", { ...payload, input }),
        key: (input: KeyInput) => ask<void>("tab.key", { ...payload, input }),
        insert: (text: string) => ask<void>("tab.insert", { ...payload, text }),
        /**
         * Shows the tab's video in this window, from a key piece. It follows the video before it starts,
         * so it misses nothing; the returned function stops both.
         */
        watch: async (receive: (piece: VideoPiece) => void) => {
            const window = await windowIdentity
            const { server: current } = await server()
            const stop = current.subscribe(videoEvent(identity), piece => receive(piece as VideoPiece))
            try {
                await ask<void>("tab.watch", { ...payload, window })
            }
            catch (error) {
                stop()
                throw error
            }
            return () => {
                stop()
                void ask("tab.unwatch", { ...payload, window }).catch(() => undefined)
            }
        },
        /** This window has shown the video up to this piece. */
        acknowledge: async (sequence: number) => {
            await ask<void>("tab.acknowledge", { ...payload, window: await windowIdentity, sequence })
        }
    }
}
