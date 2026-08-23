import { useEffect, useRef, useState } from "react"
import { useServiceState } from "@phreshos/react"
import type {
  BrowserKeyRequest,
  BrowserMetrics,
  BrowserSession,
  BrowserSnapshot,
  BrowserViewport
} from "@server/core/browser"
import { browser, browserService } from "./browser-service"
import BrowserFrames from "./browser-frames"

export type BrowserTab = Readonly<{
  session: string
  page: BrowserSession
  frames: BrowserFrames
  error: string | null
  busy: boolean
}>

type BrowserWorkspaceStatus = "pending" | "ready" | "failed"

const initialViewport: BrowserViewport = { width: 900, height: 520 }

export default function useBrowser() {
  const service = useServiceState(browserService)
  const [tabs, setTabs] = useState<readonly BrowserTab[]>([])
  const [active, setActive] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [creationError, setCreationError] = useState<string | null>(null)
  const [workspaceStatus, setWorkspaceStatus] = useState<BrowserWorkspaceStatus>("pending")
  const [metrics, setMetrics] = useState<BrowserMetrics>()
  const tabsRef = useRef(tabs)
  const initialized = useRef(false)
  const restoration = useRef(0)
  const creatingRef = useRef(false)
  const wheelInput = useRef({ session: "", deltaX: 0, deltaY: 0, frame: 0 })
  const textInput = useRef({ session: "", text: "", frame: 0 })

  tabsRef.current = tabs

  useEffect(() => {
    if (service?.enabled !== true) {
      restoration.current += 1
      initialized.current = false
      creatingRef.current = false
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
        const next = await browser.metrics()
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
    if (!active || service?.enabled !== true) return

    let live = true
    let sequence = 0
    const event = `frame:${crypto.randomUUID()}`
    const unsubscribe = browser.frames(event, frame => {
      if (!live || frame.session !== active || frame.sequence <= sequence) return
      sequence = frame.sequence
      const tab = tabsRef.current.find(tab => tab.session === active)
      if (!tab) return

      tab.frames.publish(frame)

      const next = page(frame)
      if (!samePage(tab.page, next) || tab.error) update(active, { page: next, error: null })
    })
    let heartbeat = 0

    void browser.startFrames(active, event).then(lease => {
      if (!live) {
        browser.stopFrames(active, event)
        return
      }

      heartbeat = window.setInterval(() => browser.keepFrames(active, event), Math.max(1_000, lease / 3))
    }).catch(error => {
      if (live) update(active, { error: message(error) })
    })

    return () => {
      live = false
      window.clearInterval(heartbeat)
      unsubscribe()
      browser.stopFrames(active, event)
    }
  }, [active, service?.enabled])

  useEffect(() => () => {
    if (wheelInput.current.frame) window.cancelAnimationFrame(wheelInput.current.frame)
    if (textInput.current.frame) window.cancelAnimationFrame(textInput.current.frame)
  }, [])

  async function restore(attempt: number) {
    if (creatingRef.current || service?.enabled !== true) return
    creatingRef.current = true
    setCreating(true)
    setCreationError(null)
    setWorkspaceStatus("pending")

    try {
      const workspace = await browser.workspace()
      if (restoration.current !== attempt) return

      if (workspace.sessions.length > 0) {
        setTabs(workspace.sessions.map(session => ({
          session: session.session,
          page: session,
          frames: new BrowserFrames(),
          error: null,
          busy: false
        })))
        setActive(workspace.active ?? workspace.sessions[0]?.session ?? null)
      } else {
        const snapshot = await browser.create(initialViewport)
        if (restoration.current !== attempt) return
        setTabs([tab(snapshot)])
        setActive(snapshot.session)
      }
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

  async function newTab() {
    if (creatingRef.current || service?.enabled !== true) return
    creatingRef.current = true
    setCreating(true)
    setCreationError(null)

    try {
      const snapshot = await browser.create(initialViewport)
      setTabs(current => [...current, tab(snapshot)])
      setActive(snapshot.session)
    } catch (error) {
      setCreationError(message(error))
    } finally {
      creatingRef.current = false
      setCreating(false)
    }
  }

  async function closeTab(session: string) {
    const current = tabsRef.current
    const index = current.findIndex(tab => tab.session === session)
    const nextActive = current[index + 1]?.session ?? current[index - 1]?.session ?? null
    const wasActive = active === session

    setTabs(tabs => tabs.filter(tab => tab.session !== session))
    if (wasActive) setActive(nextActive)

    await browser.close(session)
    if (wasActive && nextActive) browser.select(nextActive)
  }

  function navigate(value: string) {
    const url = address(value)
    if (active) return perform(active, () => browser.navigate(active, url))
  }

  function back() { if (active) return perform(active, () => browser.back(active)) }
  function forward() { if (active) return perform(active, () => browser.forward(active)) }
  function reload() { if (active) return perform(active, () => browser.reload(active)) }

  function resize(viewport: BrowserViewport) {
    if (active) browser.resize(active, viewport)
  }

  function click(x: number, y: number, button: "left" | "middle" | "right") {
    if (active) browser.click({ session: active, x, y, button })
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
    browser.press({ session: active, key, modifiers })
  }

  function select(session: string) {
    setActive(session)
    browser.select(session)
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
      browser.wheel({ session: pending.session, deltaX: pending.deltaX, deltaY: pending.deltaY })
    }

    wheelInput.current = { session: "", deltaX: 0, deltaY: 0, frame: 0 }
  }

  function flushText() {
    const pending = textInput.current
    if (pending.frame) window.cancelAnimationFrame(pending.frame)
    if (pending.session && pending.text) browser.type(pending.session, pending.text)
    textInput.current = { session: "", text: "", frame: 0 }
  }

  function update(session: string, values: Partial<Omit<BrowserTab, "session">>) {
    setTabs(current => current.map(tab => tab.session === session ? { ...tab, ...values } : tab))
  }

  return {
    active,
    activeTab: tabs.find(tab => tab.session === active),
    back,
    click,
    closeTab,
    creating,
    creationError,
    forward,
    metrics,
    navigate,
    newTab,
    press,
    reload,
    resize,
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

function samePage(left: BrowserSession, right: BrowserSession) {
  return left.url === right.url
    && left.title === right.title
    && left.viewport.width === right.viewport.width
    && left.viewport.height === right.viewport.height
}
