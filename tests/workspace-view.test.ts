import assert from "node:assert/strict"
import { test } from "vitest"
import type { FlamboState } from "../client/core/application"
import { resolveWorkspaceView } from "../client/view/workspace-view"
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
  return Object.freeze({ status, workspace, error: null })
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
