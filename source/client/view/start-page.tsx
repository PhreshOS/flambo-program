import { listSites, tab as tabOf } from "@client/core/flambo"
import usePromise from "@libs/react-promise"
import { Button, GridList, Heading, Input, Spinner, Surface, Text } from "@phreshos/react-ui"
import { Globe } from "@phreshos/react-ui/icons"
import { useEffect, useState } from "react"
import icon from "@/icon.png"

/** The greeting for the hour it is. */
function greeting() {
    const hour = new Date().getHours()
    return hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"
}

/**
 * What a new tab shows, drawn here rather than by the page, which is blank: a greeting, a field that
 * leads where the address bar would, and the places visited most. Nothing is captured while it shows.
 */
export default function StartPage({ tab, onDrawn }: Readonly<{ tab: string, onDrawn?: () => void }>) {
    const sites = usePromise(() => listSites(), [])
    const [text, setText] = useState("")
    const go = usePromise((address: string) => tabOf(tab).navigate(address))

    // The page counts as drawn once what it offers has arrived, or could not.
    const settled = sites.solve !== undefined || sites.exception !== undefined
    useEffect(() => { if (settled) onDrawn?.() }, [settled])

    return <Surface depth="recessed" className="screen start-page">
        <div className="start">
            <img className="start-mark" src={icon} alt="" />
            <Heading level={1} size="xlarge">{greeting()}</Heading>
            <Input
                aria-label="Search or type an address"
                className="start-search"
                placeholder="Search or type an address"
                value={text}
                invalid={go.exception !== undefined}
                onChange={setText}
                onKeyDown={event => { if (event.key === "Enter" && text.trim()) void go.safeExecute(text) }}
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
                        : <GridList aria-label="Sites you visit most" selectionMode="none" itemWidth="7.5rem" className="start-sites"
                            onAction={url => void go.safeExecute(String(url))}>
                            {sites.solve.map(site => <GridList.Item key={site.url} id={site.url} textValue={site.title}>
                                <div className="start-site">
                                    {site.icon ? <img className="start-site-icon" src={site.icon} alt="" /> : <Globe className="start-site-icon" />}
                                    <Text tone="secondary" size="small" className="start-site-title">{site.title}</Text>
                                </div>
                            </GridList.Item>)}
                        </GridList>}
        </div>
    </Surface>
}
