import { tab as tabOf, type TabEntry } from "@client/core/flambo"
import usePromise from "@libs/react-promise"
import { Button, Input } from "@phreshos/react-ui"
import { ArrowLeft, ArrowRight, RotateCw } from "@phreshos/react-ui/icons"
import { useEffect, useRef, useState } from "react"

/**
 * Where the tab is and the way around it: back, forward, reload, and the address. The address shows
 * the page's own until someone types; Enter goes there, Escape gives the page's address back.
 */
export default function Toolbar({ tab }: Readonly<{ tab: TabEntry }>) {
    const current = tabOf(tab.tab)
    // What was typed belongs to the tab it was typed in; another tab shows its own address.
    const [typing, setTyping] = useState<Readonly<{ tab: string, text: string }> | null>(null)
    const typed = typing?.tab === tab.tab ? typing.text : null
    const setTyped = (text: string | null) => setTyping(text === null ? null : { tab: tab.tab, text })
    const go = usePromise(async (address: string) => {
        await current.navigate(address)
        setTyping(null)
    })
    const shown = typed ?? (tab.url === "about:blank" ? "" : tab.url)

    // A new tab, on the start page, takes the keyboard into its address at once.
    const address = useRef<HTMLInputElement>(null)
    const fresh = tab.url === ""
    useEffect(() => { if (fresh) address.current?.focus() }, [tab.tab, fresh])

    return <div className="toolbar">
        <Button iconOnly depth="none" size="small" aria-label="Back" disabled={!tab.canGoBack} onPress={() => void current.back().catch(() => undefined)}><ArrowLeft /></Button>
        <Button iconOnly depth="none" size="small" aria-label="Forward" disabled={!tab.canGoForward} onPress={() => void current.forward().catch(() => undefined)}><ArrowRight /></Button>
        <Button iconOnly depth="none" size="small" aria-label="Reload" onPress={() => void current.reload().catch(() => undefined)}><RotateCw className={tab.loading ? "loading" : undefined} /></Button>
        <Input
            ref={address}
            aria-label="Address"
            size="small"
            className="address"
            placeholder="Search or type an address"
            value={shown}
            invalid={go.exception !== undefined}
            onChange={setTyped}
            onFocus={event => (event.target as HTMLInputElement).select()}
            onKeyDown={event => {
                if (event.key === "Enter" && shown.trim()) void go.safeExecute(shown)
                else if (event.key === "Escape") setTyped(null)
            }}
        />
    </div>
}
