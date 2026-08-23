import assert from "node:assert/strict"
import {
  input,
  navigation,
  sessionCreate,
  stream,
  workspaceAttach,
  workspaceCreate
} from "@server/view/contract"

assert.deepEqual(workspaceCreate.parse({}), { client: false })
assert.deepEqual(workspaceCreate.parse({ client: true }), { client: true })
assert.equal(workspaceCreate.safeParse({ client: false, session: true }).success, false)
assert.deepEqual(workspaceAttach.parse({}), {})

assert.deepEqual(sessionCreate.parse({
  workspace: "workspace:first",
  viewport: { width: 800, height: 500 }
}), {
  workspace: "workspace:first",
  viewport: { width: 800, height: 500 }
})
assert.equal(sessionCreate.safeParse({
  workspace: "workspace:first",
  viewport: { width: 100, height: 500 }
}).success, false)

assert.equal(navigation.parse({
  workspace: "workspace:first",
  session: "session:first",
  url: "https://example.com"
}).url, "https://example.com/")
assert.equal(navigation.safeParse({
  workspace: "workspace:first",
  session: "session:first",
  url: "file:///private/data"
}).success, false)

assert.deepEqual(input.parse({
  action: "pointer.click",
  workspace: "workspace:first",
  session: "session:first",
  x: 20,
  y: 30
}), {
  action: "pointer.click",
  workspace: "workspace:first",
  session: "session:first",
  x: 20,
  y: 30,
  button: "left"
})
assert.equal(input.safeParse({
  action: "keyboard.type",
  workspace: "workspace:first",
  session: "session:first",
  text: ""
}).success, false)

assert.equal(stream.safeParse({
  workspace: "workspace:first",
  session: "session:first",
  event: "frame:00000000-0000-0000-0000-000000000000"
}).success, true)
assert.equal(stream.safeParse({
  workspace: "workspace:first",
  session: "session:first",
  event: "workspace.change"
}).success, false)
