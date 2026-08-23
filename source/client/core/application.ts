import { current, host } from "@phreshos/client"
import { browserWorkspaceOption, type BrowserMetrics, type BrowserWorkspace } from "@server/core/browser"
import Workspace, { type WorkspaceBoundary } from "./workspace"

export type ApplicationState = Readonly<{ enabled: boolean }> | undefined

/** Client application coordinating local Workspace peers with Flambo Server. */
export default class Application {
  private readonly service = host.service({
    program: "flambo",
    endpoint: "server",
    name: "browser"
  })
  private readonly channel = this.service.channel.timeout(35_000)
  private readonly listeners = new Set<() => void>()
  private readonly workspaces = new Map<string, Workspace>()
  private readonly cleanups: Array<() => void> = []
  private state: ApplicationState
  private connecting: Promise<void> | null = null
  private workspaceConnection: Promise<Workspace> | null = null
  private currentWorkspace: Workspace | null = null
  private started = false
  private disposed = false

  public readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  public readonly snapshot = () => this.state

  public start() {
    if (this.disposed) throw new Error("The Flambo Client application is closed")
    if (this.started) return

    this.started = true
    this.cleanups.push(
      this.service.subscribe("enable", () => this.setEnabled(true)),
      this.service.subscribe("disable", () => this.connect()),
      this.service.channel.subscribe("workspace.change", snapshot => this.synchronizeWorkspace(snapshot))
    )
    this.connect()
  }

  public workspace() {
    this.start()
    if (this.currentWorkspace) return Promise.resolve(this.currentWorkspace)
    if (this.workspaceConnection) return this.workspaceConnection

    const connection = this.attachWorkspace().finally(() => {
      if (this.workspaceConnection === connection) this.workspaceConnection = null
    })
    this.workspaceConnection = connection
    return connection
  }

  public metrics() {
    this.start()
    return this.ready().then(() => this.channel.ask<BrowserMetrics>("metrics"))
  }

  public reconnect() {
    this.start()
    if (this.state?.enabled !== true) this.connect()
  }

  public dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const cleanup of this.cleanups.splice(0)) cleanup()
    this.invalidateWorkspaces()
    this.listeners.clear()
  }

  private async attachWorkspace() {
    await this.ready()
    const assigned = await current.option(browserWorkspaceOption)
    const snapshot = await this.channel.ask<BrowserWorkspace>("workspace.attach", {
      ...assigned && { workspace: assigned }
    })

    if (this.disposed) throw new Error("The Flambo Client application closed while its Workspace was attaching")

    const existing = this.workspaces.get(snapshot.workspace)
    if (existing) {
      existing.synchronize(snapshot)
      this.currentWorkspace = existing
      return existing
    }

    const workspace = new Workspace(snapshot, this.boundary(), () => {
      this.workspaces.delete(snapshot.workspace)
      if (this.currentWorkspace === workspace) this.currentWorkspace = null
    })
    this.workspaces.set(workspace.identity, workspace)
    this.currentWorkspace = workspace
    return workspace
  }

  private boundary(): WorkspaceBoundary {
    return {
      ask: <Answer>(event: string, payload?: unknown) => this.channel.ask<Answer>(event, payload),
      publish: (event, payload) => this.service.channel.publish(event, payload),
      subscribe: (event, receive) => this.service.channel.subscribe(event, receive)
    }
  }

  private synchronizeWorkspace(value: unknown) {
    const snapshot = value as Partial<BrowserWorkspace>
    if (typeof snapshot.workspace !== "string" || typeof snapshot.revision !== "number") return
    this.workspaces.get(snapshot.workspace)?.synchronize(snapshot as BrowserWorkspace)
  }

  private connect() {
    if (this.disposed || this.connecting) return

    this.invalidateWorkspaces()
    this.state = undefined
    this.emit()

    const connecting = this.ensureService().then(
      () => this.setEnabled(true),
      () => this.setEnabled(false)
    ).finally(() => {
      if (this.connecting === connecting) this.connecting = null
    })
    this.connecting = connecting
  }

  private async ensureService() {
    if (await this.service.enabled()) return

    const program = await current.program()

    await program.process.findOrCreate({
      name: "browser-server",
      server: true,
      client: false
    })

    await this.service.waitReady(30_000)
  }

  private async ready() {
    if (this.connecting) await this.connecting
    if (this.state?.enabled !== true) throw new Error("Flambo's browser Service is unavailable")
  }

  private setEnabled(enabled: boolean) {
    if (this.disposed || this.state?.enabled === enabled) return
    if (!enabled) this.invalidateWorkspaces()
    this.state = { enabled }
    this.emit()
  }

  private invalidateWorkspaces() {
    this.workspaceConnection = null
    this.currentWorkspace = null
    for (const workspace of this.workspaces.values()) workspace.invalidate()
    this.workspaces.clear()
  }

  private emit() {
    for (const listener of this.listeners) listener()
  }
}
