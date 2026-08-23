import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import Application from "@client/core/application"
import type Workspace from "@client/core/workspace"
import type {
  BrowserKeyRequest,
  BrowserMetrics,
  BrowserSession,
  BrowserSnapshot,
  BrowserViewport
} from "@server/core/browser"
import BrowserFrames from "./browser-frames"

export type BrowserTab = Readonly<{
  session: string
  page: BrowserSession
  frames: BrowserFrames
  error: string | null
  busy: boolean
}>

type BrowserWorkspaceStatus = "pending" | "ready" | "failed"

export default function useBrowser() {
  const [application] = useState(() => new Application())
  const service = useSyncExternalStore(application.subscribe, application.snapshot, application.snapshot)
  const [tabs, setTabs] = useState<readonly BrowserTab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [workspaceStatus, setWorkspaceStatus] = useState<BrowserWorkspaceStatus>("pending")
  const [metrics, setMetrics] = useState<BrowserMetrics>()
  const tabsRef = useRef(tabs)
  const workspaceRef = useRef<Workspace | null>(null)
  const stopWorkspace = useRef<() => void>(() => undefined)
  const initialized = useRef(false)
  const restoration = useRef(0)
  const creatingRef = useRef(false)
  const wheelInput = useRef({ session: "", deltaX: 0, deltaY: 0, frame: 0 })
  const textInput = useRef({ session: "", text: "", frame: 0 })
  const activeTab = tabs.find(tab => tab.session === active)

  tabsRef.current = tabs

  useEffect(() => {
    application.start()

    return () => {
      stopWorkspace.current()
      application.dispose()
      if (wheelInput.current.frame) window.cancelAnimationFrame(wheelInput.current.frame)
      if (textInput.current.frame) window.cancelAnimationFrame(textInput.current.frame)
    }
  }, [application])

  useEffect(() => {
    if (service?.enabled !== true) {
      restoration.current += 1
      initialized.current = false
      creatingRef.current = false
      stopWorkspace.current()
      stopWorkspace.current = () => undefined
      workspaceRef.current = null
      setTabs([])
      setActive(null)
      setCreating(false)
      setMetrics(undefined)
      setCreationError(null)
      setWorkspaceStatus("pending")
      return
    }

    if (initialized.current) return
    initialized.current = true
    void restore(restoration.current += 1)
  }, [service?.enabled])

  useEffect(() => {
    if (service?.enabled !== true) return

    let live = true

    const read = async () => {
      try {
        const next = await application.metrics()
        if (live) setMetrics(next)
      } catch {
        if (live) setMetrics(undefined)
      }
    }

    void read()
    const interval = window.setInterval(() => void read(), 2_000)

    return () => {
      live = false
      window.clearInterval(interval)
    }
  }, [service?.enabled])

  useEffect(() => {
    const workspace = workspaceRef.current
    if (!workspace || !active || !activeTab || activeTab.page.url === "about:blank" || service?.enabled !== true) return

    let live = true
    let sequence = 0
    const event = `frame:${crypto.randomUUID()}`
    const unsubscribe = workspace.frames(event, frame => {
      if (!live || frame.session !== active || frame.sequence <= sequence) return
      sequence = frame.sequence
      const tab = tabsRef.current.find(tab => tab.session === active)
      if (!tab) return

      tab.frames.publish(frame)

      const next = page(frame)
      if (!samePage(tab.page, next) || tab.error) update(active, { page: next, error: null })
    })
    let heartbeat = 0

    void workspace.startFrames(active, event).then(lease => {
      if (!live) {
        workspace.stopFrames(active, event)
        return
      }

      heartbeat = window.setInterval(() => workspace.keepFrames(active, event), Math.max(1_000, lease / 3))
    }).catch(error => {
      if (live) update(active, { error: message(error) })
    })

    return () => {
      live = false
      window.clearInterval(heartbeat)
      unsubscribe()
      workspace.stopFrames(active, event)
    }
  }, [active, activeTab?.page.url, service?.enabled])

  async function restore(attempt: number) {
    if (creatingRef.current || service?.enabled !== true) return
    creatingRef.current = true
    setCreating(true)
    setCreationError(null)
    setWorkspaceStatus("pending")

    try {
      const workspace = await application.workspace()
      if (restoration.current !== attempt) return
      workspaceRef.current = workspace
      stopWorkspace.current()
      stopWorkspace.current = workspace.subscribe(() => {
        if (workspaceRef.current === workspace) reconcileWorkspace(workspace)
      })

      reconcileWorkspace(workspace)
      setWorkspaceStatus("ready")
    } catch (error) {
      if (restoration.current !== attempt) return
      setCreationError(message(error))
      setWorkspaceStatus("failed")
    } finally {
      if (restoration.current === attempt) {
        creatingRef.current = false
        setCreating(false)
      }
    }
  }

  async function newTab(viewport: BrowserViewport) {
    if (creatingRef.current || service?.enabled !== true) return
    const workspace = currentWorkspace()
    creatingRef.current = true
    setCreating(true)
    setCreationError(null)

    try {
      const snapshot = await workspace.create(viewport)
      setTabs(current => current.some(tab => tab.session === snapshot.session)
        ? current.map(tab => tab.session === snapshot.session ? { ...tab, page: page(snapshot) } : tab)
        : [...current, tab(snapshot)])
      setActive(snapshot.session)
      return snapshot
    } catch (error) {
      setCreationError(message(error))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  function retry() {
    if (service?.enabled !== true) {
      application.reconnect()
      return
    }
    initialized.current = true
    void restore(restoration.current += 1)
  }

  async function closeTab(session: string) {
    const workspace = currentWorkspace()
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.session === session)
    const nextActive = current[index + 1]?.session ?? current[index - 1]?.session ?? null
    const wasActive = active === session

    setTabs(tabs => tabs.filter(tab => tab.session !== session))
    if (wasActive) setActive(nextActive)

    try {
      await workspace.closeSession(session)
      if (wasActive && nextActive) await workspace.select(nextActive)
    } catch (error) {
      setCreationError(message(error))
      await workspace.snapshot().catch(() => undefined)
      reconcileWorkspace(workspace)
    }
  }

  function navigate(value: string) {
    const url = address(value)
    if (active) return perform(active, () => currentWorkspace().navigate(active, url))
  }

  async function open(value: string, viewport: BrowserViewport) {
    if (active) return navigate(value)

    const snapshot = await newTab(viewport)
    if (snapshot) return perform(snapshot.session, () => currentWorkspace().navigate(snapshot.session, address(value)))
  }

  function back() { if (active) return perform(active, () => currentWorkspace().back(active)) }
  function forward() { if (active) return perform(active, () => currentWorkspace().forward(active)) }
  function reload() { if (active) return perform(active, () => currentWorkspace().reload(active)) }

  function resize(viewport: BrowserViewport) {
    if (active) submit(active, () => currentWorkspace().resize(active, viewport))
  }

  function click(x: number, y: number, button: "left" | "middle" | "right") {
    if (active) submit(active, () => currentWorkspace().click({ session: active, x, y, button }))
  }

  function wheel(deltaX: number, deltaY: number) {
    if (!active) return

    if (wheelInput.current.session && wheelInput.current.session !== active) flushWheel()
    const pending = wheelInput.current
    pending.session = active
    pending.deltaX += deltaX
    pending.deltaY += deltaY
    pending.frame ||= window.requestAnimationFrame(flushWheel)
  }

  function type(text: string) {
    if (!active) return

    if (textInput.current.session && textInput.current.session !== active) flushText()
    const pending = textInput.current
    pending.session = active
    pending.text += text
    pending.frame ||= window.requestAnimationFrame(flushText)
  }

  function press(key: string, modifiers: BrowserKeyRequest["modifiers"]) {
    if (!active) return
    flushText()
    submit(active, () => currentWorkspace().press({ session: active, key, modifiers }))
  }

  function select(session: string) {
    setActive(session)
    submit(session, () => currentWorkspace().select(session))
  }

  async function perform(session: string, operation: () => Promise<unknown>) {
    update(session, { busy: true, error: null })

    try {
      await operation()
      update(session, { error: null })
    } catch (error) {
      update(session, { error: message(error) })
    } finally {
      update(session, { busy: false })
    }
  }

  function flushWheel() {
    const pending = wheelInput.current
    if (pending.frame) window.cancelAnimationFrame(pending.frame)

    if (pending.session && (pending.deltaX || pending.deltaY)) {
      const { session, deltaX, deltaY } = pending
      submit(session, () => currentWorkspace().wheel({ session, deltaX, deltaY }))
    }

    wheelInput.current = { session: "", deltaX: 0, deltaY: 0, frame: 0 }
  }

  function flushText() {
    const pending = textInput.current
    if (pending.frame) window.cancelAnimationFrame(pending.frame)
    if (pending.session && pending.text) {
      const { session, text } = pending
      submit(session, () => currentWorkspace().type(session, text))
    }
    textInput.current = { session: "", text: "", frame: 0 }
  }

  function update(session: string, values: Partial<Omit<BrowserTab, "session">>) {
    setTabs(current => current.map(tab => tab.session === session ? { ...tab, ...values } : tab))
  }

  function submit(session: string, operation: () => Promise<unknown>) {
    try {
      void operation().catch(error => update(session, { error: message(error) }))
    } catch (error) {
      update(session, { error: message(error) })
    }
  }

  function currentWorkspace(): Workspace {
    const workspace = workspaceRef.current
    if (!workspace) throw new Error("The browser workspace is not ready")
    return workspace
  }

  function reconcileWorkspace(workspace: Workspace) {
    const sessions = workspace.sessions

    setTabs(current => sessions.map(session => {
      const existing = current.find(tab => tab.session === session.session)
      return existing
        ? { ...existing, page: samePage(existing.page, session) ? existing.page : session }
        : workspaceTab(session)
    }))
    setActive(workspace.active ?? sessions[0]?.session ?? null)
  }

  return {
    active,
    activeTab,
    back,
    click,
    closeTab,
    creating,
    creationError,
    forward,
    metrics,
    navigate,
    newTab,
    open,
    press,
    reload,
    resize,
    retry,
    select,
    service,
    tabs,
    type,
    wheel,
    workspaceStatus
  }
}

function address(input: string) {
  const value = input.trim()

  if (!value || value === "about:blank") return "about:blank"
  if (/^https?:\/\//i.test(value)) {
    try {
      return new URL(value).href
    } catch {
      return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
    }
  }

  if (/^[^\s/]+\.[^\s]+/.test(value)) {
    try {
      return new URL(`https://${value}`).href
    } catch {
      return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
    }
  }

  return `https://duckduckgo.com/?q=${encodeURIComponent(value)}`
}

function message(value: unknown) {
  return value instanceof Error ? value.message : "The browser operation failed"
}

function page(value: BrowserSession): BrowserSession {
  return {
    session: value.session,
    url: value.url,
    title: value.title,
    viewport: value.viewport
  }
}

function tab(snapshot: BrowserSnapshot): BrowserTab {
  const frame = { ...snapshot, sequence: 0 }

  return {
    session: snapshot.session,
    page: page(snapshot),
    frames: new BrowserFrames(frame),
    error: null,
    busy: false
  }
}

function workspaceTab(session: BrowserSession): BrowserTab {
  return {
    session: session.session,
    page: session,
    frames: new BrowserFrames(),
    error: null,
    busy: false
  }
}

function samePage(left: BrowserSession, right: BrowserSession) {
  return left.url === right.url
    && left.title === right.title
    && left.viewport.width === right.viewport.width
    && left.viewport.height === right.viewport.height
}
