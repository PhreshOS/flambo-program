import { useEffect, useState, type KeyboardEvent, type FocusEvent } from "react"
import type { BrowserTab } from "./use-browser"
import { IconBack, IconForward, IconReload, IconHome, IconLock, IconSearch, IconGlobe, IconCopy, IconCheck, IconClose } from "./icons"

type ToolbarProperties = Readonly<{
  tab: BrowserTab | undefined
  back(): void
  forward(): void
  reload(): void
  navigate(address: string): void
}>

export default function Toolbar({ tab, back, forward, reload, navigate }: ToolbarProperties) {
  const [address, setAddress] = useState("")
  const [copied, setCopied] = useState(false)
  const [isFocused, setIsFocused] = useState(false)

  const currentUrl = tab?.page.url ?? ""
  const isBlank = !currentUrl || currentUrl === "about:blank"
  const isSecure = currentUrl.startsWith("https://")
  const isHttp = currentUrl.startsWith("http://")

  useEffect(() => {
    setAddress(isBlank ? "" : currentUrl)
  }, [tab?.session, currentUrl, isBlank])

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && address.trim()) {
      navigate(address)
      event.currentTarget.blur()
    } else if (event.key === "Escape") {
      setAddress(isBlank ? "" : currentUrl)
      event.currentTarget.blur()
    }
  }

  function handleFocus(event: FocusEvent<HTMLInputElement>) {
    setIsFocused(true)
    event.currentTarget.select()
  }

  function handleBlur() {
    setIsFocused(false)
  }

  async function handleCopy() {
    if (!currentUrl || isBlank) return
    try {
      await navigator.clipboard.writeText(currentUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Fallback if clipboard API is restricted
    }
  }

  function handleHome() {
    navigate("about:blank")
  }

  function handleClear() {
    setAddress("")
  }

  return (
    <header className="toolbar" role="toolbar" aria-label="Navigation toolbar">
      <div className="nav-controls">
        <button
          type="button"
          className="tool-button"
          aria-label="Back"
          title="Back (Alt+Left)"
          disabled={!tab || tab.busy}
          onClick={back}
        >
          <IconBack />
        </button>

        <button
          type="button"
          className="tool-button"
          aria-label="Forward"
          title="Forward (Alt+Right)"
          disabled={!tab || tab.busy}
          onClick={forward}
        >
          <IconForward />
        </button>

        <button
          type="button"
          className={`tool-button ${tab?.busy ? "spinning" : ""}`}
          aria-label="Reload"
          title="Reload page (Ctrl+R)"
          disabled={!tab}
          onClick={reload}
        >
          <IconReload />
        </button>

        <button
          type="button"
          className="tool-button"
          aria-label="Home"
          title="Home page"
          disabled={!tab}
          onClick={handleHome}
        >
          <IconHome />
        </button>
      </div>

      <div className={`omnibox ${isFocused ? "focused" : ""}`}>
        <div className="omnibox-badge" aria-hidden="true">
          {isSecure ? (
            <span className="badge-secure" title="Secure Connection (HTTPS)">
              <IconLock />
            </span>
          ) : isHttp ? (
            <span className="badge-http" title="Unencrypted Connection (HTTP)">
              <IconGlobe />
            </span>
          ) : (
            <span className="badge-search" title="Search the Web">
              <IconSearch />
            </span>
          )}
        </div>

        <input
          type="text"
          inputMode="url"
          className="omnibox-input"
          aria-label="Address and search bar"
          placeholder="Search DuckDuckGo or type a web address"
          spellCheck={false}
          autoComplete="off"
          value={address}
          disabled={!tab}
          onChange={event => setAddress(event.currentTarget.value)}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
        />

        <div className="omnibox-actions">
          {address && isFocused && (
            <button
              type="button"
              className="omnibox-action-button"
              aria-label="Clear address"
              tabIndex={-1}
              onMouseDown={event => {
                event.preventDefault()
                handleClear()
              }}
            >
              <IconClose />
            </button>
          )}

          {!isBlank && (
            <button
              type="button"
              className={`omnibox-action-button ${copied ? "copied" : ""}`}
              aria-label={copied ? "Copied" : "Copy URL"}
              title={copied ? "Copied to clipboard!" : "Copy page URL"}
              onClick={handleCopy}
            >
              {copied ? <IconCheck /> : <IconCopy />}
            </button>
          )}
        </div>
      </div>

      {tab?.busy && <div className="toolbar-progress-bar" role="progressbar" aria-label="Loading page" />}
    </header>
  )
}
