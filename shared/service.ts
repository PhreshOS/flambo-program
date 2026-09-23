import { z } from "zod"
import type {
  KeyModifiers,
  PointerButton,
  TabFrame,
  TabObservationFrame,
  TabSnapshot,
  Viewport,
  WorkspaceSnapshot
} from "./flambo"

export type FlamboServiceEvents = {
  "workspace.changed": WorkspaceSnapshot
  "workspace.closed": Readonly<{ workspace: string }>
  "tab.frame": TabObservationFrame
}

export type FlamboRequests = {
  "workspace.attach": { input: undefined, output: WorkspaceSnapshot }
  "workspace.list": { input: undefined, output: readonly WorkspaceSnapshot[] }
  "workspace.create": { input: undefined, output: WorkspaceSnapshot }
  "workspace.read": { input: WorkspaceRequest, output: WorkspaceSnapshot }
  "workspace.close": { input: WorkspaceRequest, output: null }
  "tab.create": { input: WorkspaceRequest & Readonly<{ viewport: Viewport }>, output: TabSnapshot }
  "tab.close": { input: TabRequest, output: null }
  "tab.select": { input: TabRequest, output: null }
  "tab.navigate": { input: TabRequest & Readonly<{ url: string }>, output: TabSnapshot }
  "tab.back": { input: TabRequest, output: TabSnapshot }
  "tab.forward": { input: TabRequest, output: TabSnapshot }
  "tab.reload": { input: TabRequest, output: TabSnapshot }
  "tab.capture": { input: TabRequest, output: TabFrame }
  "tab.observe": { input: TabRequest, output: TabObservationFrame }
  "tab.acknowledge": { input: ObservationRequest & Readonly<{ sequence: number }>, output: null }
  "tab.unobserve": { input: ObservationRequest, output: null }
  "tab.resize": { input: TabRequest & Readonly<{ viewport: Viewport }>, output: TabSnapshot }
  "tab.movePointer": { input: TabRequest & Readonly<{ x: number, y: number }>, output: TabSnapshot }
  "tab.click": { input: TabRequest & Readonly<{ x: number, y: number, button: PointerButton }>, output: TabSnapshot }
  "tab.wheel": { input: TabRequest & Readonly<{ deltaX: number, deltaY: number }>, output: TabSnapshot }
  "tab.type": { input: TabRequest & Readonly<{ text: string }>, output: TabSnapshot }
  "tab.press": { input: TabRequest & Readonly<{ key: string, modifiers: KeyModifiers }>, output: TabSnapshot }
}

export type WorkspaceRequest = Readonly<{ workspace: string }>
export type TabRequest = WorkspaceRequest & Readonly<{ tab: string }>
export type ObservationRequest = Readonly<{ observation: string }>

const identity = z.string().min(1)
const viewport = z.object({
  width: z.number().int().positive().max(8192),
  height: z.number().int().positive().max(8192)
})
const workspace = z.object({ workspace: identity })
const tab = workspace.extend({ tab: identity })
const observation = z.object({ observation: identity })
const point = tab.extend({
  x: z.number().finite().nonnegative(),
  y: z.number().finite().nonnegative()
})

export const requests = {
  workspace,
  tab,
  tabCreate: workspace.extend({ viewport }),
  navigate: tab.extend({ url: z.string().min(1) }),
  resize: tab.extend({ viewport }),
  point,
  click: point.extend({
    button: z.enum(["left", "middle", "right"])
  }),
  wheel: tab.extend({
    deltaX: z.number().finite(),
    deltaY: z.number().finite()
  }),
  type: tab.extend({ text: z.string() }),
  press: tab.extend({
    key: z.string().min(1),
    modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"]))
  }),
  observation,
  acknowledge: observation.extend({ sequence: z.number().int().positive() })
} as const
