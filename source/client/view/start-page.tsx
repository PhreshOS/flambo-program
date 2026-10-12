import { listSites, tab as tabOf } from "@client/core/flambo"
import usePromise from "@libs/react-promise"
import { Button, GridList, Heading, Input, Spinner, Surface, Text, useAppearance, useScale } from "@phreshos/react-ui"
import { Globe } from "@phreshos/react-ui/icons"
import { searchEngine } from "@shared/search"
import { useEffect, useState } from "react"
import icon from "@/icon.png"

/** The greeting for the hour it is. */
function greeting() {
    const hour = new Date().getHours()
    return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
}

/**
 * What a new tab shows, drawn here rather than by the page, which is blank: a greeting, a field that
 * searches with Flambo's search engine, and the places visited most. Nothing is captured while it shows.
 */
export default function StartPage({ tab, onDrawn }: Readonly<{ tab: string, onDrawn?: () => void }>) {
    const sites = usePromise(() => listSites(), [])
    const space = useScale(useAppearance().spacing)
    const [text, setText] = useState("")
    const go = usePromise((address: string) => tabOf(tab).navigate(address))
    const search = usePromise((words: string) => tabOf(tab).search(words))

    // The page counts as drawn once what it offers has arrived, or could not.
    const settled = sites.solve !== undefined || sites.exception !== undefined
    useEffect(() => { if (settled) onDrawn?.() }, [settled])

    return <Surface depth="recessed" className="screen start-page">
        <div className="start">
            <img className="start-mark" src={icon} alt="" />
            <Heading level={1} size="xlarge">{greeting()}</Heading>
            <Input
                aria-label={`Search ${searchEngine.name}`}
                className="start-search"
                // A field on a container of its own color takes the second layer, the color of the cards
                // below, so it does not sink into the well.
                color="primary:subtle"
                placeholder={`Search ${searchEngine.name}`}
                value={text}
                invalid={search.exception !== undefined}
                onChange={setText}
                onKeyDown={event => { if (event.key === "Enter" && text.trim()) void search.safeExecute(text) }}
            />
            {sites.exception !== undefined
                ? <div className="start-note">
                    <Text tone="secondary">The sites you visit most could not be read.</Text>
                    <Button size="small" onPress={() => sites.execute()}>Try again</Button>
                </div>
                : sites.solve === undefined
                    ? <Spinner label="Reading the sites you visit most" size="small" />
                    : sites.solve.length === 0
                        ? <Text tone="secondary" className="start-welcome">Flambo runs on this machine. The pages you open here grow in one place, for you and for the agents you let in.</Text>
                        // The same cards as the Start menu's programs, so a site looks like something to open.
                        : <GridList aria-label="Sites you visit most" selectionMode="none" restColor="primary:subtle" itemWidth={space.xlarge * 3.5} className="start-sites"
                            // As many cards as there are, each at its own width, together in the middle.
                            style={{ gridTemplateColumns: `repeat(auto-fit, ${space.xlarge * 3.5}px)`, justifyContent: "center" }}
                            onAction={url => void go.safeExecute(String(url))}>
                            {sites.solve.map(site => <GridList.Item key={site.url} id={site.url} textValue={site.title}>
                                <span className="start-site" title={site.url} style={{ gap: space.small, paddingBlock: space.small }}>
                                    {site.icon
                                        ? <img src={site.icon} alt="" draggable={false} style={{ width: space.xlarge, height: space.xlarge }} />
                                        : <Globe size={space.xlarge} />}
                                    <Text size="small" className="start-site-title">{site.title}</Text>
                                </span>
                            </GridList.Item>)}
                        </GridList>}
        </div>
    </Surface>
}
