import { createTab, followTabs, listTabs, tab as tabOf, type TabEntry } from "@client/core/flambo"
import usePromise from "@libs/react-promise"
import { context } from "@phreshos/client"
import { useWindowState } from "@phreshos/react"
import { Button, Tabs, Window } from "@phreshos/react-ui"
import { Globe, Plus, X } from "@phreshos/react-ui/icons"
import { useEffect, useRef, useState } from "react"
import icon from "@/icon.png"
import { useFirstArrival } from "./readiness"
import Screen from "./screen/screen"
import Toolbar from "./toolbar"

/**
 * Every tab asks for this width, as in a browser, whatever its title. The tabs share the room in equal
 * columns, so when they do not all fit, each narrows to its column, evenly, rather than overlapping.
 */
const tabWidth = { width: "12rem", maxWidth: "100%", justifyContent: "flex-start" }

/**
 * Flambo as a window. Its tabs are its own pages: "+" opens one, closing a tab closes its page, and
 * closing the window closes them all. The Server opens a window's first tab; a page that opens another,
 * such as a link meant for a new tab, adds it here and shows it. Closing the last tab closes the window.
 */
export default function FlamboWindow({ window: me }: Readonly<{ window: string }>) {
    const initial = usePromise(() => listTabs(), [])
    const [followed, setFollowed] = useState<readonly TabEntry[] | null>(null)
    useEffect(() => followTabs(setFollowed), [])
    const tabs = followed ?? initial.solve ?? null

    const mine = tabs?.filter(tab => tab.window === me) ?? []
    const [chosen, setChosen] = useState<string | null>(null)
    const current = mine.find(tab => tab.tab === chosen) ?? mine.at(-1) ?? null

    // A tab that appears in this window, opened here or by a page, is shown at once.
    const known = useRef<ReadonlySet<string> | null>(null)
    useEffect(() => {
        if (tabs === null) return
        const identities = new Set(mine.map(tab => tab.tab))
        const added = known.current ? mine.filter(tab => !known.current!.has(tab.tab)) : []
        if (added.length > 0) setChosen(added.at(-1)!.tab)
        known.current = identities
    }, [tabs])

    // Once it has had tabs, losing the last closes the window.
    const hadTabs = useRef(false)
    useEffect(() => {
        if (mine.length > 0) hadTabs.current = true
        else if (hadTabs.current) void context.process().then(process => process.exit())
    }, [mine.length])

    const open = usePromise(async () => { setChosen((await createTab()).tab) })
    const window = useWindowState(context.window)
    const toggleMaximize = async () => context.window.maximize(!await context.window.maximized())

    // The window's initial state is its tabs and the first picture of the page; a problem reaching the
    // Server is shown as it is. Pictures drawn later, for another tab, appear in place.
    const [drawn, setDrawn] = useState(false)
    useFirstArrival(initial.exception !== undefined || (tabs !== null && drawn))

    if (initial.exception) return <div className="problem">
        <p>Flambo could not reach its Server.</p>
        <Button onPress={() => initial.execute()}>Try again</Button>
    </div>
    if (tabs === null) return null

    return <div className="flambo-window">
        <Window.Header
            active={window?.front ?? true}
            beginMoveGesture={start => context.presentation.beginMoveGesture(start)}
            maximized={window?.maximized ?? false}
            onMaximize={() => void toggleMaximize()}
        >
            <Window.Header.Identity icon={icon} />
            {/* The center holds the controls only; the empty header around them still moves the window. */}
            <Window.Header.Center style={{ flex: "0 1 auto", gap: "0.25rem", minWidth: 0 }}>
                {mine.length > 0 && <Tabs value={current?.tab} onChange={setChosen} size="small" style={{ minWidth: 0 }}>
                    <Tabs.List aria-label="Tabs">
                        {mine.map(tab => <Tabs.Tab key={tab.tab} id={tab.tab} style={tabWidth}>
                            <span className="tab">
                                <Favicon tab={tab} />
                                <span className="tab-title">{tab.title || "New tab"}</span>
                                <span role="button" aria-label={`Close ${tab.title || "New tab"}`} title="Close this tab" className="tab-close"
                                    onPointerDown={event => event.stopPropagation()} onClick={() => void tabOf(tab.tab).close().catch(() => undefined)}><X size={12} /></span>
                            </span>
                        </Tabs.Tab>)}
                    </Tabs.List>
                </Tabs>}
                <Button iconOnly depth="none" size="small" aria-label="New tab" disabled={open.isPending} onPress={() => void open.safeExecute()}><Plus /></Button>
            </Window.Header.Center>
            <Window.Header.Actions>
                <Window.Header.Minimize preventFocusOnPress={false} onPress={() => void context.window.minimize()} />
                <Window.Header.Maximize />
                <Window.Header.Close preventFocusOnPress={false} onPress={() => void context.process().then(process => process.exit())} />
            </Window.Header.Actions>
        </Window.Header>
        {current && <Toolbar key={current.tab} tab={current} />}
        {current ? <Screen key={current.tab} tab={current.tab} onDrawn={() => setDrawn(true)} /> : <div />}
    </div>
}

/** The page's own icon, or a globe while it has none or it cannot be shown. */
function Favicon({ tab }: Readonly<{ tab: TabEntry }>) {
    const [failed, setFailed] = useState<string | null>(null)
    if (!tab.favicon || failed === tab.favicon) return <Globe size={13} className="favicon" />
    return <img className="favicon" src={tab.favicon} alt="" onError={() => setFailed(tab.favicon)} />
}
