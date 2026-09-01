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

export type BrowserWorkspaceLifecycle = "client" | "explicit"

/** Launch option assigning a Flambo Client to an existing browser workspace. */
export const browserWorkspaceOption = "browser-workspace"

export type BrowserWorkspace = Readonly<{
  workspace: string
  lifecycle: BrowserWorkspaceLifecycle
  revision: number
  active: string | null
  sessions: readonly BrowserSession[]
}>

/** Stable Flambo service events; stream frame names are allocated at runtime. */
export type BrowserServiceEvents = {
  "workspace.change": BrowserWorkspace
}

export type BrowserMetrics = Readonly<{
  capacity: Readonly<{
    total: number
    perWorkspace: number
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
  | Readonly<{ action: "session.select", workspace: string, session: string }>
  | Readonly<{ action: "resize", workspace: string, session: string, viewport: BrowserViewport }>
  | Readonly<{ action: "pointer.click", workspace: string } & BrowserPointerRequest>
  | Readonly<{ action: "wheel", workspace: string } & BrowserWheelRequest>
  | Readonly<{ action: "keyboard.type", workspace: string, session: string, text: string }>
  | Readonly<{ action: "keyboard.press", workspace: string } & BrowserKeyRequest>
