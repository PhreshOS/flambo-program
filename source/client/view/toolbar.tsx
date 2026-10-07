import { tab as tabOf, type TabEntry } from "@client/core/flambo"
import usePromise from "@libs/react-promise"
import { Button, Input } from "@phreshos/react-ui"
import { ArrowLeft, ArrowRight, RotateCw } from "@phreshos/react-ui/icons"
import { useState } from "react"

/**
 * Where the tab is and the way around it: back, forward, reload, and the address. The address shows
 * the page's own until someone types; Enter goes there, Escape gives the page's address back.
 */
export default function Toolbar({ tab }: Readonly<{ tab: TabEntry }>) {
    const current = tabOf(tab.tab)
    const [typed, setTyped] = useState<string | null>(null)
    const go = usePromise(async (address: string) => {
        await current.navigate(address)
        setTyped(null)
    })
    const shown = typed ?? (tab.url === "about:blank" ? "" : tab.url)

    return <div className="toolbar">
        <Button iconOnly depth="none" size="small" aria-label="Back" disabled={!tab.canGoBack} onPress={() => void current.back().catch(() => undefined)}><ArrowLeft /></Button>
        <Button iconOnly depth="none" size="small" aria-label="Forward" disabled={!tab.canGoForward} onPress={() => void current.forward().catch(() => undefined)}><ArrowRight /></Button>
        <Button iconOnly depth="none" size="small" aria-label="Reload" onPress={() => void current.reload().catch(() => undefined)}><RotateCw className={tab.loading ? "loading" : undefined} /></Button>
        <Input
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
