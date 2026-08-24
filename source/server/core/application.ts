import { randomUUID } from "node:crypto"
import type { BrowserEngine } from "./browser-engine"
import BrowserSessions, { type BrowserLimits } from "./browser-sessions"
import type { BrowserWorkspaceLifecycle } from "./browser"
import Workspace from "./workspace"

export interface ClientLifecycle {
  subscribe(listener: (client: string) => unknown): () => void
}

export interface WorkspaceClient {
  readonly identity: string
  readonly assignment: string | undefined
  exited(): Promise<boolean>
  exit(): Promise<void>
}

export interface WorkspaceClients extends ClientLifecycle {
  create(workspace: string): Promise<WorkspaceClient>
}

export type ApplicationOptions = Readonly<{
  clients?: WorkspaceClients
  limits?: BrowserLimits
  leaseMilliseconds?: number
  attachmentMilliseconds?: number
}>

type Attachment = {
  readonly promise: Promise<void>
  readonly resolve: () => void
  readonly reject: (error: Error) => void
  readonly timeout: ReturnType<typeof setTimeout>
}

const defaultAttachmentMilliseconds = 15_000

/** Owns Flambo's authoritative Workspace and Session state. */
export default class Application {
  private readonly sessions: BrowserSessions
  private readonly workspaces = new Map<string, Workspace>()
  private readonly clientWorkspaces = new Map<string, string>()
  private readonly workspaceClients = new Map<string, WorkspaceClient>()
  private readonly reservedClients = new Map<string, WorkspaceClient>()
  private readonly attachments = new Map<string, Attachment>()
  private readonly closing = new Map<string, Promise<void>>()
  private readonly workspaceListeners = new Set<(workspace: Workspace) => unknown>()
  private readonly clients?: WorkspaceClients
  private readonly attachmentMilliseconds: number
  private readonly stopClientLifecycle: () => void
  private disposed = false

  public constructor(engine: BrowserEngine, options: ApplicationOptions = {}) {
    this.sessions = new BrowserSessions(engine, options.limits, options.leaseMilliseconds, identity => {
      this.workspaces.get(identity)?.synchronize()
    })
    this.clients = options.clients
    this.attachmentMilliseconds = options.attachmentMilliseconds ?? defaultAttachmentMilliseconds

    if (!Number.isInteger(this.attachmentMilliseconds) || this.attachmentMilliseconds < 1) {
      throw new Error("The Client attachment deadline must be a positive integer")
    }

    this.stopClientLifecycle = this.clients?.subscribe(client => {
      void this.closeClient(client).catch(() => undefined)
    }) ?? (() => undefined)
  }

  public workspace(identity: string) {
    const workspace = this.workspaces.get(identity)
    if (!workspace) throw new Error("The browser workspace does not exist")
    return workspace
  }

  /** Returns every live authoritative Workspace in creation order. */
  public listWorkspaces() {
    this.ensureOpen()
    return Object.freeze([...this.workspaces.values()])
  }

  public async createWorkspace(withClient: boolean) {
    this.ensureOpen()

    const workspace = await this.create(withClient ? "client" : "explicit")
    if (!withClient) return workspace

    if (!this.clients) {
      await this.releaseWorkspace(workspace.identity, false)
      throw new Error("This browser runtime cannot create a Client")
    }

    const attachment = this.createAttachment(workspace.identity)
    let launched: WorkspaceClient | undefined

    try {
      launched = await this.clients.create(workspace.identity)

      const attached = this.workspaceClients.get(workspace.identity)
      if (attached && attached.identity !== launched.identity) {
        throw new Error("A different Client attached to the reserved browser workspace")
      }

      if (!attached) this.reservedClients.set(workspace.identity, launched)
      else attachment.resolve()

      if (await launched.exited()) throw new Error("The browser Client exited before attaching its workspace")

      await attachment.promise
      return workspace
    } catch (error) {
      if (launched) {
        if (this.workspaces.has(workspace.identity) && !this.workspaceClients.has(workspace.identity)) {
          this.reservedClients.set(workspace.identity, launched)
        } else if (!await launched.exited()) {
          await launched.exit().catch(() => undefined)
        }
      }
      await this.releaseWorkspace(workspace.identity, true).catch(() => undefined)
      throw error
    } finally {
      this.finishAttachment(workspace.identity)
    }
  }

  public async attachClient(client: WorkspaceClient, identity?: string) {
    this.ensureOpen()

    const existing = this.clientWorkspaces.get(client.identity)

    if (existing) {
      if (identity && identity !== existing) throw new Error("This Client already owns another browser workspace")
      return this.workspace(existing)
    }

    if (identity && client.assignment !== identity) {
      throw new Error("The Client was not assigned to this browser workspace")
    }
    if (!identity && client.assignment) {
      throw new Error("The Client must attach to its assigned browser workspace")
    }

    const workspace = identity ? this.workspace(identity) : await this.create("client")
    if (workspace.lifecycle !== "client") throw new Error("An explicit browser workspace cannot be attached to a Client")

    if (await client.exited()) {
      if (!identity) await this.releaseWorkspace(workspace.identity, false)
      throw new Error("The browser Client exited before attaching its workspace")
    }

    const owner = this.workspaceClients.get(workspace.identity) ?? this.reservedClients.get(workspace.identity)
    if (owner && owner.identity !== client.identity) throw new Error("The browser workspace already belongs to another Client")

    this.attach(client, workspace)
    this.attachments.get(workspace.identity)?.resolve()
    return workspace
  }

  public closeWorkspace(identity: string) {
    return this.releaseWorkspace(identity, true)
  }

  public keepFrames(workspace: string, session: string, event: string) {
    this.workspaces.get(workspace)?.keepFrames(session, event)
  }

  public async stopFrames(workspace: string, session: string, event: string) {
    const current = this.workspaces.get(workspace)
    if (current) await current.stopFrames(session, event)
  }

  public metrics() { return this.sessions.metrics() }

  public subscribeWorkspaces(listener: (workspace: Workspace) => unknown) {
    this.workspaceListeners.add(listener)
    return () => this.workspaceListeners.delete(listener)
  }

  public async dispose() {
    if (this.disposed) return
    this.disposed = true
    this.stopClientLifecycle()

    const identities = [...this.workspaces.keys()]
    await Promise.all(identities.map(identity => this.releaseWorkspace(identity, true).catch(() => undefined)))

    for (const identity of [...this.attachments.keys()]) {
      this.attachments.get(identity)?.reject(new Error("The browser Server is closing"))
      this.finishAttachment(identity)
    }

    this.workspaceListeners.clear()
    await this.sessions.dispose()
  }

  private async create(lifecycle: BrowserWorkspaceLifecycle) {
    const identity = randomUUID()
    await this.sessions.createWorkspace(identity)

    if (this.disposed) {
      await this.sessions.closeWorkspace(identity).catch(() => undefined)
      throw new Error("The browser Server is closed")
    }

    const workspace = new Workspace(identity, lifecycle, this.sessions, changed => {
      for (const listener of this.workspaceListeners) listener(changed)
    })
    this.workspaces.set(identity, workspace)
    return workspace
  }

  private attach(client: WorkspaceClient, workspace: Workspace) {
    this.reservedClients.delete(workspace.identity)
    this.clientWorkspaces.set(client.identity, workspace.identity)
    this.workspaceClients.set(workspace.identity, client)
  }

  private releaseWorkspace(identity: string, exitClient: boolean): Promise<void> {
    const active = this.closing.get(identity)
    if (active) return active

    const workspace = this.workspaces.get(identity)
    if (!workspace) return Promise.resolve()

    const closing = this.finishRelease(workspace, exitClient).finally(() => {
      if (this.closing.get(identity) === closing) this.closing.delete(identity)
    })
    this.closing.set(identity, closing)
    return closing
  }

  private async finishRelease(workspace: Workspace, exitClient: boolean) {
    const identity = workspace.identity
    const client = this.workspaceClients.get(identity) ?? this.reservedClients.get(identity)

    this.workspaces.delete(identity)
    this.workspaceClients.delete(identity)
    this.reservedClients.delete(identity)
    if (client) this.clientWorkspaces.delete(client.identity)

    const attachment = this.attachments.get(identity)
    if (attachment) attachment.reject(new Error("The browser workspace closed before its Client attached"))

    const operations: Promise<unknown>[] = [workspace.close()]
    if (exitClient && client && !await client.exited()) operations.push(client.exit())
    await Promise.all(operations)
  }

  private async closeClient(client: string) {
    const attached = this.clientWorkspaces.get(client)
    if (attached) return this.releaseWorkspace(attached, false)

    for (const [workspace, reserved] of this.reservedClients) {
      if (reserved.identity === client) return this.releaseWorkspace(workspace, false)
    }
  }

  private createAttachment(workspace: string) {
    let resolve!: () => void
    let reject!: (error: Error) => void
    const promise = new Promise<void>((accept, decline) => {
      resolve = accept
      reject = decline
    })
    void promise.catch(() => undefined)
    const timeout = setTimeout(() => reject(new Error("The browser Client did not attach before the deadline")), this.attachmentMilliseconds)
    timeout.unref()

    const attachment = { promise, resolve, reject, timeout }
    this.attachments.set(workspace, attachment)
    return attachment
  }

  private finishAttachment(workspace: string) {
    const attachment = this.attachments.get(workspace)
    if (!attachment) return
    clearTimeout(attachment.timeout)
    this.attachments.delete(workspace)
  }

  private ensureOpen() {
    if (this.disposed) throw new Error("The browser Server is closed")
  }
}
