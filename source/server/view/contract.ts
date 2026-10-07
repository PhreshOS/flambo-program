import { z } from "zod"

const identity = z.string().min(1).max(100)
const tab = { tab: identity }
const coordinate = z.number().min(-100_000).max(100_000)

/** A place on the Desktop's plane: pixels, or a share of the view such as "50% - 200". */
const value = z.union([z.number(), z.string().min(1).max(100)])

const pointer = z.discriminatedUnion("type", [
    z.object({ type: z.literal("move"), x: coordinate, y: coordinate }),
    z.object({ type: z.enum(["down", "up"]), x: coordinate, y: coordinate, button: z.enum(["left", "middle", "right"]), clickCount: z.number().int().min(1).max(3) }),
    z.object({ type: z.literal("wheel"), x: coordinate, y: coordinate, deltaX: coordinate, deltaY: coordinate })
])

/** What windows, agents, and other Programs may ask Flambo's Server, and the shape of each question. */
export const contract = {
    open: z.object({ address: z.string().max(8192).optional(), position: z.object({ x: value, y: value }).optional() }),
    create: z.object({ window: identity, address: z.string().max(8192).optional() }),
    tab: z.object(tab),
    navigate: z.object({ ...tab, address: z.string().min(1).max(8192) }),
    resize: z.object({ ...tab, width: z.number().int().min(1).max(8192), height: z.number().int().min(1).max(8192), scale: z.number().min(0.5).max(4) }),
    pointer: z.object({ ...tab, input: pointer }),
    key: z.object({ ...tab, input: z.object({ type: z.enum(["down", "up"]), key: z.string().min(1).max(40) }) }),
    insert: z.object({ ...tab, text: z.string().max(1024 * 1024) }),
    press: z.object({ ...tab, keys: z.string().min(1).max(100) }),
    watch: z.object({ ...tab, window: identity }),
    acknowledge: z.object({ ...tab, window: identity, sequence: z.number().int().min(0) })
}
