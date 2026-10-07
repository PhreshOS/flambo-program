import { context } from "@phreshos/server"
import Browser from "@server/core/browser"
import Tabs, { type Windows } from "@server/core/tabs"
import { videoEvent } from "@shared/events"
import { addressOption } from "@shared/service"
import { contract } from "./contract"

/**
 * Flambo's Server: the browser and every tab, for every window and for agents. It answers questions
 * about tabs and announces two things: that the list changed, and each tab's video, under that tab's
 * own event, so a window receives only what it shows.
 */
export default async function view() {
    const program = await context.program()
    const self = await context.process()
    const browser = await Browser.launch(await program.data.path())

    // A window is any other Process of this Program; it has ended once its Process has.
    const windows: Windows = {
        followEnds(ended) { program.subscribe("processExit", event => ended(event.process.identity)) },
        async exists(window) { return await program.findProcess(window) !== null }
    }

    const tabs = new Tabs(browser, windows)

    tabs.subscribe(event => {
        if (event.type === "changed") void context.publish("tabs.changed", tabs.list())
        else void context.publish(videoEvent(event.tab), event.piece)
    })

    // Every window opens with a tab, at the address it was opened for, if any. The Server opens it,
    // so a window has its tab even before anyone looks at it, and windows that opened while no
    // Server ran get theirs when it starts.
    const firstTab = async (window: { identity: string, options(name: string): Promise<string | undefined> }) => {
        if (window.identity === self.identity || tabs.list().some(tab => tab.window === window.identity)) return
        await tabs.create(window.identity, await window.options(addressOption))
    }
    program.subscribe("processCreate", window => void firstTab(window).catch(() => undefined))
    for (const window of await program.processes()) await firstTab(window).catch(() => undefined)

    context.answer("tabs.list", () => tabs.list())

    // Another Program, an agent, or anyone opens an address in Flambo: a new window, whose first tab
    // opens it. It stands where the asker places it, such as beside the window it was asked from.
    context.answer("tab.open", async ({ payload }) => {
        const { address, position } = contract.open.parse(payload)
        const window = await program.createProcess({ server: false, client: position ? { position } : true, options: address ? { [addressOption]: address } : {} })
        return { window: window.identity }
    })

    context.answer("tab.create", async ({ payload }) => {
        const { window, address } = contract.create.parse(payload)
        return await tabs.create(window, address)
    })

    context.answer("tab.close", ({ payload }) => tabs.close(contract.tab.parse(payload).tab))

    context.answer("tab.navigate", async ({ payload }) => {
        const { tab, address } = contract.navigate.parse(payload)
        await tabs.get(tab).navigate(address)
    })

    context.answer("tab.back", ({ payload }) => tabs.get(contract.tab.parse(payload).tab).back())
    context.answer("tab.forward", ({ payload }) => tabs.get(contract.tab.parse(payload).tab).forward())
    context.answer("tab.reload", ({ payload }) => tabs.get(contract.tab.parse(payload).tab).reload())

    context.answer("tab.resize", ({ payload }) => {
        const { tab, ...viewport } = contract.resize.parse(payload)
        return tabs.get(tab).resize(viewport)
    })

    context.answer("tab.pointer", ({ payload }) => {
        const { tab, input } = contract.pointer.parse(payload)
        return tabs.get(tab).pointer(input)
    })

    context.answer("tab.key", ({ payload }) => {
        const { tab, input } = contract.key.parse(payload)
        return tabs.get(tab).key(input)
    })

    context.answer("tab.insert", ({ payload }) => {
        const { tab, text } = contract.insert.parse(payload)
        return tabs.get(tab).insert(text)
    })

    context.answer("tab.press", ({ payload }) => {
        const { tab, keys } = contract.press.parse(payload)
        return tabs.get(tab).press(keys)
    })

    // For agents and others who read a page rather than watch it.
    context.answer("tab.text", ({ payload }) => tabs.get(contract.tab.parse(payload).tab).text())
    context.answer("tab.picture", ({ payload }) => tabs.get(contract.tab.parse(payload).tab).picture())

    // A window shows a tab: from here on its video is sent, starting from a key piece, and the
    // window says how far it has shown it.
    context.answer("tab.watch", ({ payload }) => {
        const { tab, window } = contract.watch.parse(payload)
        return tabs.get(tab).watch(window)
    })

    context.answer("tab.unwatch", ({ payload }) => {
        const { tab, window } = contract.watch.parse(payload)
        tabs.get(tab).unwatch(window)
    })

    context.answer("tab.acknowledge", ({ payload }) => {
        const { tab, window, sequence } = contract.acknowledge.parse(payload)
        tabs.get(tab).acknowledge(window, sequence)
    })
}
