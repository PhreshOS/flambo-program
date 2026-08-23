import { HostProvider, useHostTheme } from "@phreshos/react"
import { useState } from "react"
import type { BrowserViewport } from "@server/core/browser"
import "./style.css"
import useBrowser from "./use-browser"
import Surface from "./surface"
import Toolbar from "./toolbar"
import Tabs from "./tabs"
import { IconGlobe, IconReload, IconSparkles } from "./icons"

export default function App() {
  return (
    <HostProvider provide={["theme"]} fallback={<LoadingState message="Initializing PhreshOS…" />}>
      <ThemedBrowser />
    </HostProvider>
  )
}

function ThemedBrowser() {
  const theme = useHostTheme()
  const state = useBrowser()
  const [viewport, setViewport] = useState<BrowserViewport | null>(null)

  const activeUrl = state.activeTab?.page.url

  if (!state.service) {
    return <LoadingState message="Connecting to Flambo…" />
  }

  if (!state.service.enabled) {
    return (
      <main className="service-state error">
        <div className="state-card">
          <div className="state-icon">⚠️</div>
          <h2>Service Unavailable</h2>
          <p>Flambo's browser service is currently unavailable.</p>
          <button type="button" className="retry-button" onClick={state.retry}>
            <IconReload /> Try Again
          </button>
        </div>
      </main>
    )
  }

  if (state.workspaceStatus === "pending") {
    return <LoadingState message="Restoring your browser…" />
  }

  if (state.workspaceStatus === "failed" && state.creationError) {
    return (
      <main className="service-state error">
        <div className="state-card">
          <div className="state-icon">⚠️</div>
          <h2>Session Initialization Failed</h2>
          <p>{state.creationError}</p>
          <button type="button" className="retry-button" onClick={state.retry}>
            <IconReload /> Try Again
          </button>
        </div>
      </main>
    )
  }

  return (
    <main
      className="browser-shell"
      style={{
        "--theme-bg": theme.background,
        "--theme-fg": theme.foreground,
        "--theme-accent": theme.accent,
        "--theme-radius": `${theme.radius}px`,
        "--theme-spacing": `${theme.spacing}px`
      } as React.CSSProperties}
    >
      <Tabs
        tabs={state.tabs}
        active={state.active}
        creating={state.creating || !viewport}
        select={state.select}
        close={session => void state.closeTab(session)}
        create={() => viewport && void state.newTab(viewport)}
      />

      <Toolbar
        tab={state.activeTab}
        back={() => void state.back()}
        forward={() => void state.forward()}
        reload={() => void state.reload()}
        navigate={address => viewport && void state.open(address, viewport)}
      />

      <Surface
        tab={state.activeTab}
        navigate={address => void state.navigate(address)}
        reload={() => void state.reload()}
        back={() => void state.back()}
        click={(x, y, button) => void state.click(x, y, button)}
        wheel={(deltaX, deltaY) => void state.wheel(deltaX, deltaY)}
        type={text => void state.type(text)}
        press={(key, modifiers) => void state.press(key, modifiers)}
        measure={next => setViewport(current => sameViewport(current, next) ? current : next)}
        resize={viewport => void state.resize(viewport)}
      />

      <footer className="browser-footer">
        <div className="footer-left">
          <span className="status-indicator live" title="Connected to Flambo" />
          <span className="footer-url" title={activeUrl ?? ""}>
            {formatFooterUrl(activeUrl)}
          </span>
        </div>

        {state.metrics && (
          <div className="footer-metrics">
            <span className="metric-badge" title="Active Sessions / Total Capacity">
              <IconGlobe className="metric-icon" />
              {state.metrics.sessions.active} / {state.metrics.capacity.total}
            </span>
            <span className="metric-badge" title="Rendered Frames">
              {state.metrics.streams.frames.toLocaleString()} frames
            </span>
            <span className="metric-badge" title="Average Operation Latency">
              {state.metrics.operations.averageMilliseconds.toFixed(1)} ms
            </span>
          </div>
        )}
      </footer>
    </main>
  )
}

function sameViewport(left: BrowserViewport | null, right: BrowserViewport) {
  return left?.width === right.width && left.height === right.height
}

function LoadingState({ message }: Readonly<{ message: string }>) {
  return (
    <main className="service-state">
      <div className="state-card loading-card">
        <div className="loading-spinner-large" />
        <div className="loading-copy">
          <div className="loading-title">
            <IconSparkles /> Flambo
          </div>
          <p>{message}</p>
        </div>
      </div>
    </main>
  )
}

function formatFooterUrl(url: string | undefined): string {
  if (!url || url === "about:blank") return "Flambo"
  if (url.startsWith("data:")) {
    const end = url.indexOf(";")
    const mime = end > 5 ? url.slice(5, end) : "document"
    return `data:${mime} (${Math.round(url.length / 1024)} KB)`
  }
  if (url.startsWith("blob:")) return "Blob Document"
  return url
}
