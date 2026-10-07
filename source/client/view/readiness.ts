import { useState } from "react"
import { useRequirement } from "@phreshos/react-ui"

/**
 * Holds the nearest Loading until something has arrived for the first time. What arrives later,
 * such as another session's screen, never covers the window again: it is shown in place.
 */
export function useFirstArrival(arrived: boolean) {
    const [once, setOnce] = useState(arrived)
    if (arrived && !once) setOnce(true)
    useRequirement(once)
}

/** Declares that something has not arrived yet, from where there is nothing else to draw. */
export function Arrival({ arrived }: Readonly<{ arrived: boolean }>) {
    useFirstArrival(arrived)
    return null
}
