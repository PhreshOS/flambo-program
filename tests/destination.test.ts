import { expect, test } from "vitest"
import { destination } from "@server/core/tab/tab"
import { searchEngine } from "@shared/search"

test("an address keeps its scheme, or is given one", () => {
    expect(destination("https://example.com/a")).toBe("https://example.com/a")
    expect(destination("example.com")).toBe("https://example.com")
    expect(destination("  en.wikipedia.org/wiki/Garden ")).toBe("https://en.wikipedia.org/wiki/Garden")
    expect(destination("data:text/html,<p>hi</p>")).toBe("data:text/html,<p>hi</p>")
})

test("this machine is reached over plain HTTP", () => {
    expect(destination("localhost:4300")).toBe("http://localhost:4300")
    expect(destination("127.0.0.1:8080/path")).toBe("http://127.0.0.1:8080/path")
})

test("words that cannot be an address are searched for", () => {
    expect(destination("how gardens grow")).toBe(searchEngine.address + encodeURIComponent("how gardens grow"))
    expect(destination("flambo")).toBe(searchEngine.address + "flambo")
})
