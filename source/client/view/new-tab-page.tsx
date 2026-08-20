import { useState, type FormEvent } from "react"
import { IconSearch, IconSparkles, IconExternalLink, IconGlobe } from "./icons"

type NewTabPageProps = Readonly<{
  navigate(url: string): void
}>

type QuickLink = Readonly<{
  title: string
  url: string
  category: string
  color: string
  initials: string
}>

const quickLinks: readonly QuickLink[] = [
  {
    title: "DuckDuckGo",
    url: "https://duckduckgo.com",
    category: "Search",
    color: "#de5833",
    initials: "DDG"
  },
  {
    title: "Wikipedia",
    url: "https://en.wikipedia.org",
    category: "Knowledge",
    color: "#636466",
    initials: "W"
  },
  {
    title: "GitHub",
    url: "https://github.com",
    category: "Code",
    color: "#24292e",
    initials: "GH"
  },
  {
    title: "MDN Web Docs",
    url: "https://developer.mozilla.org",
    category: "Reference",
    color: "#1d70b8",
    initials: "MDN"
  },
  {
    title: "Hacker News",
    url: "https://news.ycombinator.com",
    category: "Tech",
    color: "#ff6600",
    initials: "HN"
  },
  {
    title: "OpenStreetMap",
    url: "https://www.openstreetmap.org",
    category: "Maps",
    color: "#7ebc6f",
    initials: "OSM"
  },
  {
    title: "Internet Archive",
    url: "https://archive.org",
    category: "Library",
    color: "#333333",
    initials: "IA"
  },
  {
    title: "W3C Standards",
    url: "https://www.w3.org",
    category: "Web",
    color: "#005a9c",
    initials: "W3C"
  }
]

export default function NewTabPage({ navigate }: NewTabPageProps) {
  const [query, setQuery] = useState("")

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (query.trim()) navigate(query)
  }

  return (
    <div className="new-tab-container">
      <div className="new-tab-hero">
        <div className="hero-badge">
          <IconSparkles />
          <span>Flambo</span>
        </div>
        <h1 className="hero-title">Where to next?</h1>
        <p className="hero-subtitle">Search the web or explore fast shortcuts with full isolation.</p>

        <form className="hero-search-form" onSubmit={handleSubmit}>
          <div className="hero-search-wrapper">
            <IconSearch className="hero-search-icon" />
            <input
              type="text"
              className="hero-search-input"
              placeholder="Search with DuckDuckGo or enter any web URL…"
              value={query}
              onChange={event => setQuery(event.currentTarget.value)}
              autoFocus
            />
            <button type="submit" className="hero-search-button" disabled={!query.trim()}>
              Explore
            </button>
          </div>
        </form>
      </div>

      <div className="quick-links-section">
        <div className="section-header">
          <div className="section-title-wrap">
            <IconGlobe />
            <h2>Quick Access</h2>
          </div>
          <span className="section-hint">Click any card to start browsing</span>
        </div>

        <div className="quick-links-grid">
          {quickLinks.map(link => (
            <button
              key={link.url}
              type="button"
              className="quick-link-card"
              onClick={() => navigate(link.url)}
            >
              <div className="card-avatar" style={{ backgroundColor: link.color }}>
                {link.initials}
              </div>
              <div className="card-info">
                <span className="card-title">{link.title}</span>
                <span className="card-category">{link.category}</span>
              </div>
              <IconExternalLink className="card-arrow" />
            </button>
          ))}
        </div>
      </div>

      <div className="new-tab-footer-tips">
        <div className="tip-item">
          <strong>Tip:</strong> You can type any domain directly (e.g. <code>example.com</code>) in the address bar.
        </div>
        <div className="tip-item">
          <strong>Security:</strong> Every session runs in its own isolated server-owned browser context.
        </div>
      </div>
    </div>
  )
}
