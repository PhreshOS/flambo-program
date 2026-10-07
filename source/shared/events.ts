/** The event that carries one tab's video: a window follows only the tab it shows. */
export function videoEvent(tab: string) {
    return `video.${tab}`
}
