import assert from "node:assert/strict"
import { renderToStaticMarkup } from "react-dom/server"
import { test } from "vitest"
import Readiness, { ReadinessState, useReadiness } from "../client/readiness"

test("Flambo begins with unresolved providers, workspace, and first frame", () => {
  const system = { message: "Connecting to System…" }
  const desktop = { message: "Connecting to Desktop…" }
  const workspace = { message: "Loading workspace…" }
  const frame = { message: "Rendering workspace…" }
  const initial = ReadinessState.start([system, desktop, workspace, frame])

  assert.deepEqual(initial.pending, [system, desktop, workspace, frame])
  assert.deepEqual(initial.ready(system).ready(desktop).ready(workspace).pending, [frame])
  assert.deepEqual(initial.ready(system).ready(desktop).ready(workspace).ready(frame).pending, [])

  function PendingMessage() {
    const { pending } = useReadiness<{ message: string }>()
    return <span>{pending[0]?.message}</span>
  }

  assert.match(renderToStaticMarkup(<Readiness requirements={[system]}><PendingMessage /></Readiness>), /Connecting to System/)
})
