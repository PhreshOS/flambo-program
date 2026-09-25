import assert from "node:assert/strict"
import { test } from "vitest"
import type { FlamboState } from "../client/core/application"
import { initialWorkspacePainted, resolveWorkspaceView } from "../client/view/workspace-view"
import type { WorkspaceSnapshot } from "../shared/flambo"

const tab = Object.freeze({
  id: "tab",
  url: "about:blank",
  title: "",
  favicon: null,
  loading: false,
  canGoBack: false,
  canGoForward: false,
  viewport: { width: 800, height: 600 }
})

function state(status: FlamboState["status"], workspace: WorkspaceSnapshot | null): FlamboState {
  return Object.freeze({ status, workspace, frame: null, error: null })
}

test("Workspace view preserves loading until attachment establishes the snapshot", () => {
  assert.deepEqual(resolveWorkspaceView(state("connecting", null)), { phase: "loading" })
  assert.deepEqual(resolveWorkspaceView(state("connecting", Object.freeze({
    id: "workspace",
    revision: 1,
    activeTab: tab.id,
    tabs: Object.freeze([tab])
  }))), { phase: "loading" })
})

test("Workspace view reports empty only from an authoritative empty snapshot", () => {
  assert.deepEqual(resolveWorkspaceView(state("ready", null)), { phase: "unavailable" })
  assert.deepEqual(resolveWorkspaceView(state("ready", Object.freeze({
    id: "workspace",
    revision: 1,
    activeTab: null,
    tabs: []
  }))), { phase: "empty" })
})

test("Workspace view distinguishes an active Tab from a missing active selection", () => {
  const workspace = Object.freeze({
    id: "workspace",
    revision: 1,
    activeTab: tab.id,
    tabs: Object.freeze([tab])
  })
  assert.deepEqual(resolveWorkspaceView(state("ready", workspace)), { phase: "tab", tab })
  assert.deepEqual(resolveWorkspaceView(state("ready", Object.freeze({
    ...workspace,
    activeTab: "missing"
  }))), { phase: "inactive" })
})

test("initial readiness waits for a remote Tab's first painted frame", () => {
  const workspace = Object.freeze({
    id: "workspace",
    revision: 1,
    activeTab: tab.id,
    tabs: Object.freeze([{ ...tab, url: "https://example.com/" }])
  })
  const initial = state("ready", workspace)
  const frame = Object.freeze({
    observation: "first-observation",
    sequence: 1,
    tab: tab.id,
    viewport: tab.viewport,
    mimeType: "image/jpeg" as const,
    data: Uint8Array.from([1])
  })

  assert.equal(initialWorkspacePainted(initial, null), false)
  assert.equal(initialWorkspacePainted({ ...initial, frame }, null), false)
  assert.equal(initialWorkspacePainted({ ...initial, frame }, { observation: "previous", tab: tab.id }), false)
  assert.equal(initialWorkspacePainted({ ...initial, frame }, { observation: frame.observation, tab: tab.id }), true)
  assert.equal(initialWorkspacePainted(state("ready", { ...workspace, tabs: [tab] }), null), true)
  assert.equal(initialWorkspacePainted(state("failed", workspace), null), true)
})
