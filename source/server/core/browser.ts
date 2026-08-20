export type BrowserViewport = Readonly<{
  width: number
  height: number
}>

export type BrowserSession = Readonly<{
  session: string
  url: string
  title: string
  viewport: BrowserViewport
}>

export type BrowserSnapshot = BrowserSession & Readonly<{
  image: string
  capturedAt: number
}>

export type BrowserFrame = BrowserSnapshot & Readonly<{
  sequence: number
}>

export type BrowserWorkspace = Readonly<{
  active: string | null
  sessions: readonly BrowserSession[]
}>

export type BrowserMetrics = Readonly<{
  capacity: Readonly<{
    total: number
    perOwner: number
  }>
  sessions: Readonly<{
    opening: number
    active: number
    created: number
    peak: number
  }>
  streams: Readonly<{
    active: number
    frames: number
    bytes: number
  }>
  operations: Readonly<{
    active: number
    completed: number
    failed: number
    peak: number
    averageMilliseconds: number
    maximumMilliseconds: number
  }>
}>

export type BrowserPointerRequest = Readonly<{
  session: string
  x: number
  y: number
  button?: "left" | "middle" | "right"
}>

export type BrowserWheelRequest = Readonly<{
  session: string
  deltaX: number
  deltaY: number
}>

export type BrowserKeyRequest = Readonly<{
  session: string
  key: string
  modifiers?: readonly ("Alt" | "Control" | "Meta" | "Shift")[]
}>

export type BrowserInputRequest =
  | Readonly<{ action: "session.select", session: string }>
  | Readonly<{ action: "resize", session: string, viewport: BrowserViewport }>
  | Readonly<{ action: "pointer.click" } & BrowserPointerRequest>
  | Readonly<{ action: "wheel" } & BrowserWheelRequest>
  | Readonly<{ action: "keyboard.type", session: string, text: string }>
  | Readonly<{ action: "keyboard.press" } & BrowserKeyRequest>
