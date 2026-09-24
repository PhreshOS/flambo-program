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
