import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent, type PointerEvent, type WheelEvent } from "react"
import { desktop, system } from "@phreshos/client"
import { DesktopProvider, SystemProvider, useDesktopPreferences, useSystemAppearance } from "@phreshos/react"
import { Button, Input, ProgressBar, Surface, Toolbar, UIProvider } from "@phreshos/react-ui"
import Application from "./core/application"
import type { TabObservationFrame, TabSnapshot, Viewport } from "../shared/flambo"

export default function App({ application }: Readonly<{ application: Application }>) {
  return <SystemProvider system={system} fallback={<Loading label="Connecting to System…" />}>
    <DesktopProvider desktop={desktop} fallback={<Loading label="Connecting to Desktop…" />}>
      <Theme application={application} />
    </DesktopProvider>
  </SystemProvider>
}

function Theme({ application }: Readonly<{ application: Application }>) {
  const appearance = useSystemAppearance()
  const preferences = useDesktopPreferences()
  return <UIProvider appearance={appearance} preferences={preferences}><FlamboWindow application={application} /></UIProvider>
}

function FlamboWindow({ application }: Readonly<{ application: Application }>) {
  const state = useSyncExternalStore(application.subscribe, application.snapshot)
  const workspace = state.workspace
  const active = workspace?.tabs.find(tab => tab.id === workspace.activeTab) ?? null
  const viewport = useRef<Viewport>({ width: 1024, height: 720 })
  const rememberViewport = useCallback((value: Viewport) => { viewport.current = value }, [])
  const createTab = () => application.createTab(viewport.current).catch(error => application.fail(error))
  const createWorkspace = () => application.createWorkspace().catch(error => application.fail(error))

  return <main className="flambo-shell">
    <Surface className="tab-strip" radius="none" shadow={false}>
      <Button aria-label="New workspace" size="xsmall" onPress={createWorkspace}><Icon name="workspace" /></Button>
      <div className="tabs" aria-label="Flambo tabs">
        {workspace?.tabs.map(tab => <FlamboTab
          key={tab.id}
          tab={tab}
          active={tab.id === workspace.activeTab}
          onSelect={() => void application.selectTab(tab.id).catch(error => application.fail(error))}
          onClose={() => void application.closeTab(tab.id).then(() => {
            if (workspace.tabs.length === 1) return createTab()
          }).catch(error => application.fail(error))}
        />)}
      </div>
      <Button aria-label="New tab" size="xsmall" onPress={createTab}><Icon name="plus" /></Button>
    </Surface>

    <Navigation application={application} tab={active} />

    <PageViewport
      application={application}
      tab={active}
      frame={state.frame}
      onViewport={rememberViewport}
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
  return <div className="flambo-tab">
    <Button
      aria-current={active ? "page" : undefined}
      color={active ? "primary:soft" : "default:subtle"}
      size="small"
      onPress={onSelect}
      style={{ flex: "1 1 auto", justifyContent: "start" }}
    >
      <Icon name="page" />
      <span className="tab-title">{tab.title || newTabTitle(tab.url)}</span>
    </Button>
    <Button aria-label={`Close ${tab.title || "tab"}`} size="xsmall" onPress={onClose}><Icon name="close" /></Button>
  </div>
}

function Navigation({ application, tab }: Readonly<{ application: Application, tab: TabSnapshot | null }>) {
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

function PageViewport({ application, frame, onViewport, tab }: Readonly<{
  application: Application
  frame: TabObservationFrame | null
  onViewport: (viewport: Viewport) => void
  tab: TabSnapshot | null
}>) {
  const stage = useRef<HTMLDivElement>(null)
  const image = useRef<HTMLImageElement>(null)
  const frameURL = useFrameURL(frame)

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

  const point = (event: PointerEvent<HTMLImageElement>) => {
    if (!frame) return null
    const bounds = event.currentTarget.getBoundingClientRect()
    return {
      x: (event.clientX - bounds.left) * frame.viewport.width / bounds.width,
      y: (event.clientY - bounds.top) * frame.viewport.height / bounds.height
    }
  }

  const pointer = (event: PointerEvent<HTMLImageElement>) => {
    if (!tab || event.button > 2) return
    const position = point(event)
    if (!position) return
    image.current?.focus()
    const button = event.button === 1 ? "middle" : event.button === 2 ? "right" : "left"
    void application.click(tab.id, position.x, position.y, button).catch(error => application.fail(error))
    event.preventDefault()
  }

  const movePointer = (event: PointerEvent<HTMLImageElement>) => {
    if (!tab) return
    const position = point(event)
    if (!position) return
    void application.movePointer(tab.id, position.x, position.y).catch(error => application.fail(error))
  }

  const wheel = (event: WheelEvent<HTMLImageElement>) => {
    if (!tab) return
    void application.wheel(tab.id, event.deltaX, event.deltaY).catch(error => application.fail(error))
    event.preventDefault()
  }

  const key = (event: KeyboardEvent<HTMLImageElement>) => {
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

  return <Surface ref={stage} className="page-viewport" color="background:base" material="none" radius="none" shadow={false}>
    {!tab ? <EmptyPage title="No open tabs" detail="Open a tab to begin browsing." />
      : !frameURL || frame?.tab !== tab.id
        ? <div className="page-loading"><ProgressBar aria-label="Loading page" indeterminate size="small" /></div>
        : <img
          ref={image}
          className="page-frame"
          src={frameURL}
          alt={`Rendered page: ${tab.title || tab.url}`}
          draggable={false}
          tabIndex={0}
          onLoad={() => frame && application.acknowledge(frame)}
          onError={() => frame && application.acknowledge(frame)}
          onPointerDown={pointer}
          onPointerMove={movePointer}
          onWheel={wheel}
          onKeyDown={key}
          onContextMenu={event => event.preventDefault()}
        />}
  </Surface>
}

function useFrameURL(frame: TabObservationFrame | null) {
  const [url, setURL] = useState<string | null>(null)
  useEffect(() => {
    if (!frame) {
      setURL(null)
      return
    }
    const bytes = frame.data.slice()
    const next = URL.createObjectURL(new Blob([bytes.buffer], { type: frame.mimeType }))
    setURL(next)
    return () => URL.revokeObjectURL(next)
  }, [frame])
  return url
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
