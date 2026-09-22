export type Viewport = Readonly<{
  width: number
  height: number
}>

export type TabSnapshot = Readonly<{
  id: string
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  viewport: Viewport
}>

export type TabFrame = Readonly<{
  tab: string
  viewport: Viewport
  mimeType: "image/jpeg"
  data: Uint8Array
}>

export type TabObservationFrame = TabFrame & Readonly<{
  observation: string
  sequence: number
}>

export type WorkspaceSnapshot = Readonly<{
  id: string
  revision: number
  activeTab: string | null
  tabs: readonly TabSnapshot[]
}>

export type PageState = Readonly<{
  url: string
  title: string
  canGoBack: boolean
  canGoForward: boolean
  viewport: Viewport
}>

export type PointerButton = "left" | "middle" | "right"

export type KeyModifiers = readonly ("Alt" | "Control" | "Meta" | "Shift")[]
