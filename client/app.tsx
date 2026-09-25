import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, type WheelEvent } from "react"
import { context, desktop, system } from "@phreshos/client"
import { DesktopProvider, SystemProvider, useDesktopPreferences, useSystemAppearance, useWindowState } from "@phreshos/react"
import { Button, Input, ProgressBar, Surface, Toolbar, UIProvider, Window, useContrastingColor } from "@phreshos/react-ui"
import flamboIcon from "../icon.png"
import Application from "./core/application"
import type { TabObservationFrame, TabSnapshot, Viewport } from "../shared/flambo"
import { initialWorkspacePainted, resolveWorkspaceView, type WorkspaceView } from "./view/workspace-view"
import Readiness, { useReadiness, useReady } from "./readiness"

type Requirement = Readonly<{ message: string }>

const systemRequirement = Object.freeze<Requirement>({ message: "Connecting to System…" })
const desktopRequirement = Object.freeze<Requirement>({ message: "Connecting to Desktop…" })
const workspaceRequirement = Object.freeze<Requirement>({ message: "Loading workspace…" })
const frameRequirement = Object.freeze<Requirement>({ message: "Rendering workspace…" })
const startupRequirements = Object.freeze([
  systemRequirement,
  desktopRequirement,
  workspaceRequirement,
  frameRequirement
])

export default function App({ application }: Readonly<{ application: Application }>) {
  return <Readiness requirements={startupRequirements}>
    <FlamboReadiness>
      <SystemProvider system={system}>
        <ReadyStage requirement={systemRequirement}>
          <DesktopProvider desktop={desktop}>
            <ReadyStage requirement={desktopRequirement}>
              <Theme application={application} />
            </ReadyStage>
          </DesktopProvider>
        </ReadyStage>
      </SystemProvider>
    </FlamboReadiness>
  </Readiness>
}

function FlamboReadiness({ children }: Readonly<{ children: ReactNode }>) {
  const { pending } = useReadiness<Requirement>()
  const [revealed, setRevealed] = useState(false)

  // Only the first workspace composition is gated; later navigation stays visible.
  useLayoutEffect(() => {
    if (pending.length === 0) setRevealed(true)
  }, [pending])

  return <div className="flambo-readiness-stage">
    <div className="flambo-readiness-content" inert={!revealed} aria-hidden={!revealed} style={{ opacity: revealed ? 1 : 0 }}>
      {children}
    </div>
    {!revealed && <div className="flambo-initial-loading"><Loading label={pending[0]?.message ?? "Loading workspace…"} /></div>}
  </div>
}

function ReadyStage({ children, requirement }: Readonly<{ children: ReactNode, requirement: Requirement }>) {
  useReady(requirement)
  return children
}

function Theme({ application }: Readonly<{ application: Application }>) {
  const appearance = useSystemAppearance()
  const preferences = useDesktopPreferences()
  return <UIProvider appearance={appearance} preferences={preferences}><FlamboWindow application={application} /></UIProvider>
}

function FlamboWindow({ application }: Readonly<{ application: Application }>) {
  const state = useSyncExternalStore(application.subscribe, application.snapshot)
  const workspace = state.workspace
  const view = resolveWorkspaceView(state)
  const active = view.phase === "tab" ? view.tab : null
  const [initialPaint, setInitialPaint] = useState<Readonly<{ observation: string, tab: string }> | null>(null)
  const onPainted = useCallback((frame: TabObservationFrame) => {
    setInitialPaint(current => current?.observation === frame.observation && current.tab === frame.tab
      ? current
      : { observation: frame.observation, tab: frame.tab })
  }, [])
  const workspaceReady = state.status === "failed" || state.status === "ready" && workspace !== null
  const frameReady = initialWorkspacePainted(state, initialPaint)
  const viewport = useRef<Viewport>({ width: 1024, height: 720 })
  const address = useRef<HTMLInputElement>(null)
  const rememberViewport = useCallback((value: Viewport) => { viewport.current = value }, [])
  const createTab = () => application.createTab(viewport.current).catch(error => application.fail(error))
  const createWorkspace = () => application.createWorkspace(viewport.current).catch(error => application.fail(error))
  const window = useWindowState(context.window)
  const actOnWindow = (operation: () => Promise<unknown>) => void operation().catch(error => application.fail(error))
  const toggleMaximize = async () => context.window.maximize(!await context.window.maximized())
  const close = async () => (await context.process()).exit()

  return <main className="flambo-shell">
    {workspaceReady && <ReadyStage requirement={workspaceRequirement}>{null}</ReadyStage>}
    {frameReady && <ReadyStage requirement={frameRequirement}>{null}</ReadyStage>}
    <Window.Header
      className="window-titlebar"
      active={window?.front ?? true}
      beginMoveGesture={start => context.presentation.beginMoveGesture(start)}
      maximized={window?.maximized ?? false}
      onMaximize={() => actOnWindow(toggleMaximize)}
      onMoveError={error => application.fail(error)}
    >
      <Window.Header.Identity icon={flamboIcon} />
      {/* Center stops drag propagation, so it must cover controls only; unused
          header space remains owned by the draggable Header root. */}
      <Window.Header.Center className="window-tabs" style={{ flex: "0 1 auto" }}>
        <div className="tabs" aria-label="Flambo tabs">
          {workspace?.tabs.map(tab => <FlamboTab
            key={tab.id}
            tab={tab}
            active={tab.id === workspace.activeTab}
            onSelect={() => void application.selectTab(tab.id).catch(error => application.fail(error))}
            onClose={() => void application.closeTab(tab.id).catch(error => application.fail(error))}
          />)}
        </div>
        <Button aria-label="New tab" size="xsmall" disabled={!workspace} onPress={createTab}><Icon name="plus" /></Button>
      </Window.Header.Center>
      <Window.Header.Actions>
        <Window.Header.Action aria-label="New workspace" onPress={createWorkspace}><Icon name="workspace" /></Window.Header.Action>
        <Window.Header.Minimize preventFocusOnPress={false} onPress={() => actOnWindow(() => context.window.minimize())} />
        <Window.Header.Maximize />
        <Window.Header.Close preventFocusOnPress={false} onPress={() => actOnWindow(close)} />
      </Window.Header.Actions>
    </Window.Header>

    <Navigation addressRef={address} application={application} tab={active} />

    <PageViewport
      application={application}
      view={view}
      frame={state.frame}
      onPainted={onPainted}
      onViewport={rememberViewport}
      onFocusAddress={() => address.current?.focus()}
      onNewTab={createTab}
      onNewWorkspace={createWorkspace}
    />

    {state.error && <Surface className="flambo-error" color="danger:soft" material="basic" radius="small" role="alert">
      <span>{state.error}</span>
      <Button size="xsmall" color="danger:base" onPress={() => location.reload()}>Reconnect</Button>
    </Surface>}
  </main>
}

function FlamboTab({ active, onClose, onSelect, tab }: Readonly<{
  active: boolean
  onClose: () => void
  onSelect: () => void
  tab: TabSnapshot
}>) {
  const color = active ? "primary:soft" : "default:subtle"
  const contentColor = useContrastingColor(color)

  return <div className="flambo-tab">
    <Button
      className="tab-select"
      aria-current={active ? "page" : undefined}
      color={color}
      size="xsmall"
      onPress={onSelect}
      style={{
        gridAutoColumns: "initial",
        gridTemplateColumns: "max-content minmax(0, 1fr)",
        justifyContent: "start",
        overflow: "hidden"
      }}
    >
      {tab.loading
        ? <span className="tab-loading" aria-label="Loading page" role="status" />
        : tab.favicon
          ? <img className="tab-favicon" src={tab.favicon} alt="" />
          : <Icon name="page" />}
      <span className="tab-title">{tab.title || newTabTitle(tab.url)}</span>
    </Button>
    <button className="tab-close" style={{ color: contentColor }} type="button" aria-label={`Close ${tab.title || "tab"}`} onClick={onClose}><Icon name="close" /></button>
  </div>
}

function Navigation({ addressRef, application, tab }: Readonly<{ addressRef: RefObject<HTMLInputElement | null>, application: Application, tab: TabSnapshot | null }>) {
  const [address, setAddress] = useState(tab?.url === "about:blank" ? "" : tab?.url ?? "")

  useEffect(() => {
    setAddress(tab?.url === "about:blank" ? "" : tab?.url ?? "")
  }, [tab?.id, tab?.url])

  const act = (operation: () => Promise<unknown>) => void operation().catch(error => application.fail(error))
  const navigate = (event: FormEvent) => {
    event.preventDefault()
    if (tab && address.trim()) act(() => application.navigate(tab.id, navigationTarget(address)))
  }

  return <Surface className="navigation" radius="none" shadow={false}>
    <Toolbar aria-label="Page navigation" gap="xsmall" style={{ width: "100%" }}>
      <Toolbar.Group gap="xsmall">
        <Button aria-label="Back" size="small" disabled={!tab?.canGoBack} onPress={() => tab && act(() => application.back(tab.id))}><Icon name="back" /></Button>
        <Button aria-label="Forward" size="small" disabled={!tab?.canGoForward} onPress={() => tab && act(() => application.forward(tab.id))}><Icon name="forward" /></Button>
        <Button aria-label="Reload" size="small" disabled={!tab} onPress={() => tab && act(() => application.reload(tab.id))}><Icon name="reload" /></Button>
      </Toolbar.Group>
      <form className="address-form" onSubmit={navigate}>
        <Input
          ref={addressRef}
          aria-label="Address and search"
          placeholder="Search or enter an address"
          size="small"
          value={address}
          onChange={setAddress}
          disabled={!tab}
          autoComplete="off"
          spellCheck="false"
        />
      </form>
    </Toolbar>
  </Surface>
}

function PageViewport({ application, frame, onFocusAddress, onNewTab, onNewWorkspace, onPainted, onViewport, view }: Readonly<{
  application: Application
  frame: TabObservationFrame | null
  onViewport: (viewport: Viewport) => void
  onFocusAddress: () => void
  onNewTab: () => void
  onNewWorkspace: () => void
  onPainted: (frame: TabObservationFrame) => void
  view: WorkspaceView
}>) {
  const tab = view.phase === "tab" ? view.tab : null
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [painted, setPainted] = useState<Readonly<{ observation: string, tab: string }> | null>(null)

  useEffect(() => {
    const element = stage.current
    if (!element || !tab) return
    const observer = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      if (!box) return
      const viewport = { width: Math.max(1, Math.round(box.width)), height: Math.max(1, Math.round(box.height)) }
      onViewport(viewport)
      void application.resize(tab.id, viewport).catch(error => application.fail(error))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [application, onViewport, tab?.id])

  useEffect(() => {
    const element = canvas.current
    if (!element || !frame || !tab || frame.tab !== tab.id) {
      setPainted(null)
      return
    }

    let current = true
    const bytes = frame.data.slice()
    void createImageBitmap(new Blob([bytes.buffer], { type: frame.mimeType })).then(bitmap => {
      if (!current) {
        bitmap.close()
        return
      }

      const context = element.getContext("2d")
      if (!context) throw new Error("Canvas rendering is unavailable for the Flambo Tab")
      element.width = frame.viewport.width
      element.height = frame.viewport.height
      context.drawImage(bitmap, 0, 0, element.width, element.height)
      bitmap.close()
      setPainted({ observation: frame.observation, tab: frame.tab })
      onPainted(frame)
      application.acknowledge(frame)
    }).catch(error => {
      if (!current) return
      // A malformed frame is consumed even though it cannot be displayed;
      // otherwise acknowledgement backpressure would permanently stall the stream.
      application.acknowledge(frame)
      application.fail(error)
    })

    return () => { current = false }
  }, [application, frame, onPainted, tab?.id])

  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!frame) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * frame.viewport.width / bounds.width,
      y: (event.clientY - bounds.top) * frame.viewport.height / bounds.height
    }
  }

  const pointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!tab || event.button > 2) return
    const position = point(event)
    if (!position) return
    canvas.current?.focus()
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"
    void application.click(tab.id, position.x, position.y, button).catch(error => application.fail(error))
    event.preventDefault()
  }

  const movePointer = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!tab) return
    const position = point(event)
    if (!position) return
    void application.movePointer(tab.id, position.x, position.y).catch(error => application.fail(error))
  }

  const wheel = (event: WheelEvent<HTMLCanvasElement>) => {
    if (!tab) return
    void application.wheel(tab.id, event.deltaX, event.deltaY).catch(error => application.fail(error))
    event.preventDefault()
  }

  const key = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!tab) return
    const modifiers = [
      event.altKey && "Alt",
      event.ctrlKey && "Control",
      event.metaKey && "Meta",
      event.shiftKey && "Shift"
    ].filter(Boolean) as ("Alt" | "Control" | "Meta" | "Shift")[]
    const operation = event.key.length === 1 && modifiers.every(value => value === "Shift")
      ? application.type(tab.id, event.key)
      : application.press(tab.id, event.key, modifiers)
    void operation.catch(error => application.fail(error))
    event.preventDefault()
  }

  const displaying = !!frame && painted?.observation === frame.observation && painted.tab === tab?.id

  const content = (() => {
    switch (view.phase) {
      case "loading":
        return <div className="loading"><ProgressBar label="Loading workspace…" indeterminate /></div>
      case "unavailable":
        return <Surface className="page-surface" color="background:base" material="none" radius="none" shadow={false}>
          <EmptyPage title="Workspace unavailable" detail="This workspace is no longer available." />
        </Surface>
      case "empty":
        return <Surface className="page-surface" color="background:base" material="none" radius="none" shadow={false}>
          <EmptyPage title="No open tabs" detail="Open a tab to begin browsing." />
        </Surface>
      case "inactive":
        return <Surface className="page-surface" color="background:base" material="none" radius="none" shadow={false}>
          <EmptyPage title="No active tab" detail="Select a tab to continue browsing." />
        </Surface>
      case "tab": {
        const activeTab = view.tab
        return activeTab.url === "about:blank"
          ? <WelcomePage onFocusAddress={onFocusAddress} onNewTab={onNewTab} onNewWorkspace={onNewWorkspace} />
          : <Surface className="page-surface" color="background:base" material="none" radius="none" shadow={false}>
            <canvas
              ref={canvas}
              className="page-frame"
              aria-label={`Rendered page: ${activeTab.title || activeTab.url}`}
              role="img"
              tabIndex={0}
              hidden={!displaying}
              onPointerDown={pointer}
              onPointerMove={movePointer}
              onWheel={wheel}
              onKeyDown={key}
              onContextMenu={event => event.preventDefault()}
            />
          </Surface>
      }
      default:
        return view satisfies never
    }
  })()

  // This host remains stable while the Tab moves between local chrome and a
  // remote page. The viewport observer must never remain attached to a root
  // that React replaced during the first navigation.
  return <div ref={stage} className="page-viewport">{content}</div>
}

function WelcomePage({ onFocusAddress, onNewTab, onNewWorkspace }: Readonly<{
  onFocusAddress: () => void
  onNewTab: () => void
  onNewWorkspace: () => void
}>) {
  return <div className="welcome-page">
    <img className="welcome-icon" src={flamboIcon} alt="" />
    <div className="welcome-copy">
      <h1>Welcome to Flambo</h1>
      <p>Search or enter an address to start browsing.</p>
    </div>
    <Toolbar aria-label="Flambo shortcuts" className="welcome-shortcuts" gap="xsmall">
      <Button color="primary:soft" size="small" onPress={onFocusAddress}>Address bar</Button>
      <Button size="small" onPress={onNewTab}><Icon name="plus" />New tab</Button>
      <Button size="small" onPress={onNewWorkspace}><Icon name="workspace" />New workspace</Button>
    </Toolbar>
  </div>
}

function EmptyPage({ detail, title }: Readonly<{ detail: string, title: string }>) {
  return <div className="empty-page"><Icon name="page" /><strong>{title}</strong><span>{detail}</span></div>
}

function Loading({ label }: Readonly<{ label: string }>) {
  return <main className="loading"><ProgressBar label={label} indeterminate /></main>
}

function navigationTarget(value: string) {
  const input = value.trim()
  if (/^[a-z][a-z\d+.-]*:/iu.test(input)) return input
  if (!input.includes(" ") && (input.includes(".") || input === "localhost" || input.startsWith("localhost:"))) {
    return `https://${input}`
  }
  return `https://duckduckgo.com/?q=${encodeURIComponent(input)}`
}

function newTabTitle(url: string) {
  return url === "about:blank" ? "New Tab" : url
}

function Icon({ name }: Readonly<{ name: "back" | "close" | "forward" | "page" | "plus" | "reload" | "workspace" }>) {
  const path = {
    back: <path d="m10 4-4 4 4 4M6 8h7" />,
    close: <path d="m5 5 6 6m0-6-6 6" />,
    forward: <path d="m6 4 4 4-4 4m4-4H3" />,
    page: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />,
    plus: <path d="M8 3v10M3 8h10" />,
    reload: <path d="M12.5 6A5 5 0 1 0 13 9m-.5-6v3h-3" />,
    workspace: <path d="M2.5 4.5h11v7h-11zM5 2.5h6M5 13.5h6" />
  }[name]
  return <svg className="icon" aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{path}</svg>
}
