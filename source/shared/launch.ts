/**
 * The Flambo Server: the one Process, named "flambo", that holds the browser and every tab. Flambo's
 * own windows find it by this name; its Server holds the "flambo" Service, as the definition declares,
 * which is how agents and other Programs reach it.
 */
export const flamboLaunch = { name: "flambo", server: true, client: false } as const

/** The Process option that names the address a window's first tab opens. */
export const addressOption = "address"
