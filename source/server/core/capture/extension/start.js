// Flambo's start page: a greeting, a search field, and the sites visited most. Words typed here go to
// Flambo's Server, which decides, as for the address bar, whether they are an address or a search.

const hour = new Date().getHours()
document.querySelector(".greeting").textContent = hour < 5 ? "Good night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

document.querySelector(".search").addEventListener("submit", event => {
    event.preventDefault()
    const text = event.target.elements.text.value.trim()
    if (text) chrome.runtime.sendMessage({ type: "navigate", text })
})

/** How many of the sites visited most the page shows. */
const shown = 8

chrome.topSites.get(all => {
    // Only places on the web; not pages made in place, nor this page itself.
    const sites = all.filter(site => /^https?:/.test(site.url) && !site.url.startsWith("https://chromewebstore.google.com"))
    const list = document.querySelector(".sites")
    for (const site of sites.slice(0, shown)) {
        const link = document.createElement("a")
        link.className = "site"
        link.href = site.url
        const icon = document.createElement("span")
        icon.className = "site-icon"
        const image = document.createElement("img")
        image.alt = ""
        image.src = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(site.url)}&size=32`)
        icon.append(image)
        const title = document.createElement("span")
        title.className = "site-title"
        title.textContent = site.title || new URL(site.url).hostname
        link.append(icon, title)
        list.append(link)
    }
    // Before any site has been visited, the page says what Flambo is instead.
    document.querySelector(".welcome").hidden = sites.length > 0
})
