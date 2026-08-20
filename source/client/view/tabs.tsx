import type { MouseEvent } from "react"
import type { BrowserTab } from "./use-browser"
import { IconClose, IconGlobe, IconPlus } from "./icons"

type TabsProperties = Readonly<{
  tabs: readonly BrowserTab[]
  active: string | null
  creating: boolean
  select(session: string): void
  close(session: string): void
  create(): void
}>

export default function Tabs({ tabs, active, creating, select, close, create }: TabsProperties) {
  function handleAuxClick(event: MouseEvent, session: string) {
    if (event.button === 1) {
      event.preventDefault()
      close(session)
    }
  }

  return (
    <nav className="tabs" role="tablist" aria-label="Browser tabs">
      <div className="tabs-list">
        {tabs.map(tab => {
          const isActive = tab.session === active
          const tabLabel = tab.page.title || formatTabTitle(tab.page.url)

          return (
            <div
              className={`tab ${isActive ? "active" : ""}`}
              key={tab.session}
              onAuxClick={event => handleAuxClick(event, tab.session)}
              title={tab.page.title ? `${tab.page.title} (${tab.page.url})` : tab.page.url}
            >
              <button
                className="tab-select"
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => select(tab.session)}
              >
                <span className="tab-icon-wrap" aria-hidden="true">
                  {tab.busy ? (
                    <span className="tab-spinner" />
                  ) : (
                    <IconGlobe className="tab-favicon" />
                  )}
                </span>
                <span className="tab-title">{tabLabel}</span>
              </button>

              <button
                className="tab-close"
                type="button"
                aria-label={`Close tab: ${tabLabel}`}
                onClick={event => {
                  event.stopPropagation()
                  close(tab.session)
                }}
              >
                <IconClose />
              </button>
            </div>
          )
        })}
      </div>

      <button
        className="new-tab-button"
        type="button"
        aria-label="Open new tab"
        title="Open new tab (Ctrl+T)"
        disabled={creating}
        onClick={create}
      >
        <IconPlus />
      </button>
    </nav>
  )
}

function formatTabTitle(url: string): string {
  if (!url || url === "about:blank") return "New Tab"
  if (url.startsWith("data:")) return "Data Document"
  if (url.startsWith("blob:")) return "Blob Document"
  try {
    const parsed = new URL(url)
    const host = parsed.hostname.replace(/^www\./, "")
    if (host) return host
    const path = parsed.pathname.split("/").filter(Boolean).pop()
    return path ? path : (url.length > 24 ? url.slice(0, 24) + "…" : url)
  } catch {
    return url.length > 24 ? url.slice(0, 24) + "…" : url
  }
}
