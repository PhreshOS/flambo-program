import type { FlamboState } from "../core/application"
import type { TabSnapshot } from "../../shared/flambo"

export type WorkspaceView =
  | Readonly<{ phase: "loading" }>
  | Readonly<{ phase: "unavailable" }>
  | Readonly<{ phase: "empty" }>
  | Readonly<{ phase: "inactive" }>
  | Readonly<{ phase: "tab", tab: TabSnapshot }>

/** Resolves only states established by the current Client projection. */
export function resolveWorkspaceView(state: FlamboState): WorkspaceView {
  // A missing snapshot while attachment is pending says nothing about its
  // eventual contents; only an authoritative snapshot can establish empty.
  if (state.status === "connecting") return { phase: "loading" }
  if (!state.workspace) return { phase: "unavailable" }
  if (state.workspace.tabs.length === 0) return { phase: "empty" }

  const tab = state.workspace.tabs.find(candidate => candidate.id === state.workspace?.activeTab)
  return tab ? { phase: "tab", tab } : { phase: "inactive" }
}

/** The first remote page belongs to initial composition only after its canvas has painted. */
export function initialWorkspacePainted(
  state: FlamboState,
  painted: Readonly<{ observation: string, tab: string }> | null
) {
  if (state.status === "failed") return true
  if (state.status !== "ready" || !state.workspace) return false

  const active = state.workspace.tabs.find(tab => tab.id === state.workspace?.activeTab)
  if (!active || active.url === "about:blank") return true

  return state.frame !== null
    && painted !== null
    && state.frame.tab === active.id
    && painted.tab === active.id
    && painted.observation === state.frame.observation
}
