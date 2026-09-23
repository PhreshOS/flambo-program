import { randomUUID } from "node:crypto"
import type { WorkspaceSnapshot } from "../../shared/flambo"
import type { BrowserEngine } from "./browser-engine"
import Workspace from "./workspace"

export interface WorkspaceClient {
  readonly identity: string
  readonly assignment: string | undefined
  readonly subscribeExit: (listener: () => unknown) => () => void
  readonly exited: () => Promise<boolean>
  readonly exit: () => Promise<void>
}

export interface WorkspaceClients {
  readonly create: (workspace: string) => Promise<WorkspaceClient>
}

export type ApplicationEvent =
  | Readonly<{ type: "workspace.changed", snapshot: WorkspaceSnapshot }>
  | Readonly<{ type: "workspace.closed", workspace: string }>

/** Owns the complete authoritative set of live Flambo Workspaces. */
export default class Application {
  private readonly workspaces = new Map<string, Workspace>()
  private readonly clientsByWorkspace = new Map<string, WorkspaceClient>()
  private readonly workspaceByClient = new Map<string, string>()
  private readonly clientSubscriptions = new Map<string, () => void>()
  private readonly listeners = new Set<(event: ApplicationEvent) => unknown>()
  private lifecycle: Promise<void> = Promise.resolve()
  private disposed = false

  public constructor(
    private readonly engine: BrowserEngine,
    private readonly clients: WorkspaceClients
  ) {}

  /** Creates one Workspace and its distinct presenting Client. */
  public async createWorkspace() {
    return await this.scheduleLifecycle(async () => {
      const workspace = await this.createUnboundWorkspace()

      try {
        this.bind(workspace, await this.clients.create(workspace.id))
        return workspace
      } catch (error) {
        await this.closeUnboundWorkspace(workspace)
        throw error
      }
    })
  }

  /** Resolves the one Workspace permanently associated with a Client Process. */
  public async attachClient(client: WorkspaceClient) {
    return await this.scheduleLifecycle(async () => {
      const attached = this.workspaceByClient.get(client.identity)
      if (attached) return this.workspace(attached)

      const workspace = client.assignment
        ? this.workspace(client.assignment)
        : await this.createUnboundWorkspace()

      this.bind(workspace, client)
      return workspace
    })
  }

  public workspace(id: string) {
    this.ensureOpen()
    const workspace = this.workspaces.get(id)
    if (!workspace) throw new Error("The Flambo Workspace does not exist")
    return workspace
  }

  public async listWorkspaces() {
    this.ensureOpen()
    return Promise.all([...this.workspaces.values()].map(workspace => workspace.snapshot()))
  }

  public async closeWorkspace(id: string) {
    await this.scheduleLifecycle(() => this.finishWorkspace(id, true))
  }

  public subscribe(listener: (event: ApplicationEvent) => unknown) {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  public async dispose() {
    if (this.disposed) return
    this.disposed = true
    await this.lifecycle
    const entries = [...this.workspaces.entries()]
    this.workspaces.clear()
    const clients = [...this.clientsByWorkspace.values()]
    this.clientsByWorkspace.clear()
    this.workspaceByClient.clear()
    for (const release of this.clientSubscriptions.values()) release()
    this.clientSubscriptions.clear()
    await Promise.allSettled(entries.map(([, workspace]) => workspace.close()))
    await Promise.allSettled(clients.map(async client => {
      if (!await client.exited()) await client.exit()
    }))
    await this.engine.close()
    this.listeners.clear()
  }

  private async createUnboundWorkspace() {
    this.ensureOpen()
    const context = await this.engine.createWorkspace()

    if (this.disposed) {
      await context.close().catch(() => undefined)
      throw new Error("The Flambo application is closed")
    }

    const workspace = new Workspace(randomUUID(), context)
    workspace.subscribe(snapshot => {
      this.emit({ type: "workspace.changed", snapshot })
    })
    this.workspaces.set(workspace.id, workspace)
    this.emit({ type: "workspace.changed", snapshot: await workspace.snapshot() })
    return workspace
  }

  private bind(workspace: Workspace, client: WorkspaceClient) {
    const currentClient = this.clientsByWorkspace.get(workspace.id)
    if (currentClient && currentClient.identity !== client.identity) {
      throw new Error("The Flambo Workspace already belongs to another Client")
    }

    const currentWorkspace = this.workspaceByClient.get(client.identity)
    if (currentWorkspace && currentWorkspace !== workspace.id) {
      throw new Error("The Flambo Client already belongs to another Workspace")
    }

    if (currentClient) return

    this.clientsByWorkspace.set(workspace.id, client)
    this.workspaceByClient.set(client.identity, workspace.id)
    // A document reload only restarts the Client execution context. The
    // Process exit is the lifetime boundary shared with its Workspace.
    this.clientSubscriptions.set(client.identity, client.subscribeExit(() => {
      void this.releaseClient(client.identity)
    }))
  }

  private releaseClient(identity: string) {
    return this.scheduleLifecycle(async () => {
      const workspace = this.workspaceByClient.get(identity)
      if (workspace) await this.finishWorkspace(workspace, false)
    }).catch(() => undefined)
  }

  private async finishWorkspace(id: string, exitClient: boolean) {
    const workspace = this.workspace(id)
    const client = this.clientsByWorkspace.get(id)

    this.workspaces.delete(id)
    this.clientsByWorkspace.delete(id)
    if (client) {
      this.workspaceByClient.delete(client.identity)
      this.clientSubscriptions.get(client.identity)?.()
      this.clientSubscriptions.delete(client.identity)
    }

    await workspace.close()
    this.emit({ type: "workspace.closed", workspace: id })
    if (exitClient && client && !await client.exited()) await client.exit()
  }

  private async closeUnboundWorkspace(workspace: Workspace) {
    this.workspaces.delete(workspace.id)
    await workspace.close()
    this.emit({ type: "workspace.closed", workspace: workspace.id })
  }

  private scheduleLifecycle<Result>(operation: () => Promise<Result>): Promise<Result> {
    this.ensureOpen()
    const task = this.lifecycle.then(operation)
    this.lifecycle = task.then(() => undefined, () => undefined)
    return task
  }

  private ensureOpen() {
    if (this.disposed) throw new Error("The Flambo application is closed")
  }

  private emit(event: ApplicationEvent) {
    for (const listener of this.listeners) listener(event)
  }
}
