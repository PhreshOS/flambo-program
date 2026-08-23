import { z } from "zod"

const identity = z.string().trim().min(1).max(100)

export const viewport = z.object({
  width: z.number().int().min(240).max(1_920),
  height: z.number().int().min(160).max(1_080)
}).strict()

export const workspaceCreate = z.object({
  client: z.boolean().default(false)
}).strict()

export const workspaceAttach = z.object({
  workspace: identity.optional()
}).strict()

export const workspaceRequest = z.object({ workspace: identity }).strict()

export const sessionRequest = z.object({
  workspace: identity,
  session: identity
}).strict()

export const sessionCreate = z.object({
  workspace: identity,
  viewport
}).strict()

export const navigation = sessionRequest.extend({
  url: z.string().trim().min(1).max(8_192).refine(value => {
    if (value === "about:blank") return true

    try {
      const url = new URL(value)
      return url.protocol === "http:" || url.protocol === "https:"
    } catch {
      return false
    }
  }, "Navigation requires an HTTP or HTTPS URL").transform(value => {
    if (value === "about:blank") return value
    const url = new URL(value)
    return url.href
  })
}).strict()

export const frameEvent = z.string().max(100).regex(/^frame:[0-9a-f-]{36}$/)

export const stream = sessionRequest.extend({ event: frameEvent }).strict()

const pointer = sessionRequest.extend({
  action: z.literal("pointer.click"),
  x: z.number().finite().min(0).max(1_920),
  y: z.number().finite().min(0).max(1_080),
  button: z.enum(["left", "middle", "right"]).default("left")
}).strict()

const wheel = sessionRequest.extend({
  action: z.literal("wheel"),
  deltaX: z.number().finite().min(-10_000).max(10_000),
  deltaY: z.number().finite().min(-10_000).max(10_000)
}).strict()

const keyboardType = sessionRequest.extend({
  action: z.literal("keyboard.type"),
  text: z.string().min(1).max(4_096)
}).strict()

const keyboardPress = sessionRequest.extend({
  action: z.literal("keyboard.press"),
  key: z.string().min(1).max(100),
  modifiers: z.array(z.enum(["Alt", "Control", "Meta", "Shift"])).max(4).optional()
}).strict()

export const input = z.discriminatedUnion("action", [
  sessionRequest.extend({ action: z.literal("session.select") }).strict(),
  sessionRequest.extend({ action: z.literal("resize"), viewport }).strict(),
  pointer,
  wheel,
  keyboardType,
  keyboardPress
])
