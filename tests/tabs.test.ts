import { expect, test, vi } from "vitest"
import type Browser from "@server/core/browser"
import Tabs from "@server/core/tabs"

// A tab here is only what the list keeps of it: its identity, its window, and its place.
vi.mock("@server/core/tab/tab", () => {
    let next = 0
    return {
        default: class {
            public readonly identity = `t${next++}`
            public description() { return { tab: this.identity } }
            public subscribe() { return () => undefined }
            public async close() {}
        }
    }
})

async function fixture() {
    const browser = { open: async () => ({}), followPopups: () => undefined, capture: {} } as unknown as Browser
    const tabs = new Tabs(browser, { followEnds: () => undefined, exists: async () => true })
    const changes = vi.fn()
    // Two windows' tabs, opened in turns, so each window's tabs lie between the other's.
    const opened = []
    for (const window of ["a", "b", "a", "b", "a"]) opened.push((await tabs.create(window)).tab)
    tabs.subscribe(changes)
    const order = (window: string) => tabs.list().filter(tab => tab.window === window).map(tab => tab.tab)
    return { tabs, opened, order, changes }
}

test("a tab moves among its own window's tabs, and every window hears the new order", async () => {
    const { tabs, opened: [a0, b0, a1, b1, a2], order, changes } = await fixture()

    tabs.move(a2!, 0)
    expect(order("a")).toEqual([a2, a0, a1])
    expect(order("b")).toEqual([b0, b1])
    expect(changes).toHaveBeenCalledOnce()

    tabs.move(a2!, 2)
    expect(order("a")).toEqual([a0, a1, a2])
    tabs.move(a0!, 99)
    expect(order("a")).toEqual([a1, a2, a0])
    expect(order("b")).toEqual([b0, b1])
})

test("a move to where it already is changes nothing", async () => {
    const { tabs, opened: [a0], changes } = await fixture()

    tabs.move(a0!, 0)

    expect(changes).not.toHaveBeenCalled()
    expect(() => tabs.move("gone", 0)).toThrow(/closed/)
})
