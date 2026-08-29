import type { Endpoint, SystemEndpointEntity } from "@phreshos/core"
import { current, system } from "@phreshos/server"
import Application, { type WorkspaceClient, type WorkspaceClients } from "@server/core/application"
import { browserWorkspaceOption, type BrowserInputRequest } from "@server/core/browser"
import ChromiumEngine from "@server/core/chromium"
import {
  input,
  navigation,
  sessionCreate,
  sessionRequest,
  stream,
  workspaceAttach,
  workspaceCreate,
  workspaceRequest
} from "./contract"

const clients = new Map<string, Promise<WorkspaceClient>>()

export default async function service() {
  const application = new Application(new ChromiumEngine(), { clients: clientLifecycle() })

  application.subscribeWorkspaces(workspace => {
    void workspace.snapshot().then(snapshot => current.publish("workspace.change", snapshot)).catch(() => undefined)
  })

  current.answer("workspace.create", async message => {
    const request = workspaceCreate.parse(message.payload)
    return (await application.createWorkspace(request.client)).snapshot()
  })

  current.answer("workspace.list", async () => {
    return Promise.all(application.listWorkspaces().map(workspace => workspace.snapshot()))
  })

  current.answer("workspace.attach", async message => {
    const request = workspaceAttach.parse(message.payload)
    const workspace = await application.attachClient(await workspaceClient(message.from), request.workspace)
    return workspace.snapshot()
  })

  current.answer("workspace.read", async message => {
    const request = workspaceRequest.parse(message.payload)
    return application.workspace(request.workspace).snapshot()
  })

  current.answer("workspace.close", async message => {
    const request = workspaceRequest.parse(message.payload)
    await application.closeWorkspace(request.workspace)
    return null
  })

  current.answer("session.create", async message => {
    const request = sessionCreate.parse(message.payload)
    return application.workspace(request.workspace).create(request.viewport)
  })

  current.answer("session.close", async message => {
    const request = sessionRequest.parse(message.payload)
    await application.workspace(request.workspace).closeSession(request.session)
    return null
  })

  current.answer("snapshot", async message => {
    const request = sessionRequest.parse(message.payload)
    return application.workspace(request.workspace).capture(request.session)
  })

  current.answer("navigate", async message => {
    const request = navigation.parse(message.payload)
    await application.workspace(request.workspace).navigate(request.session, request.url)
    return null
  })

  current.answer("back", async message => {
    const request = sessionRequest.parse(message.payload)
    await application.workspace(request.workspace).back(request.session)
    return null
  })

  current.answer("forward", async message => {
    const request = sessionRequest.parse(message.payload)
    await application.workspace(request.workspace).forward(request.session)
    return null
  })

  current.answer("reload", async message => {
    const request = sessionRequest.parse(message.payload)
    await application.workspace(request.workspace).reload(request.session)
    return null
  })

  current.answer("input", async message => {
    await performInput(application, input.parse(message.payload))
    return null
  })

  current.answer("stream.start", async message => {
    const request = stream.parse(message.payload)
    return application.workspace(request.workspace).startFrames(
      request.session,
      request.event,
      frame => current.publish(request.event, frame)
    )
  })

  current.answer("stream.stop", async message => {
    const request = stream.parse(message.payload)
    await application.stopFrames(request.workspace, request.session, request.event)
    return null
  })

  current.subscribe("stream.keepalive", message => {
    const request = stream.safeParse(message.payload)
    if (!request.success) return
    application.keepFrames(request.data.workspace, request.data.session, request.data.event)
  })

  current.subscribe("stream.stop", message => {
    const request = stream.safeParse(message.payload)
    if (!request.success) return
    void application.stopFrames(request.data.workspace, request.data.session, request.data.event).catch(() => undefined)
  })

  current.answer("metrics", () => application.metrics())

  try {
    await current.enableService("browser")
  } catch (error) {
    await application.dispose()
    throw error
  }
}

function clientLifecycle(): WorkspaceClients {
  return {
    async create(workspace) {
      const program = await current.program()
      const process = await program.process.create({
        server: false,
        client: true,
        options: { [browserWorkspaceOption]: workspace }
      })
      const client = processClient(process)
      clients.set(process.identity, client)
      return client
    },
    subscribe(listener) {
      const stopEndpoint = system.process.subscribe("endpointStop", endpoint => {
        void releaseWorkspaceClient(endpoint, listener).catch(() => undefined)
      })
      const stopProcess = system.process.subscribe("exit", ({ process }) => {
        clients.delete(process.identity)
        listener(process.identity)
      })
      return () => {
        stopEndpoint()
        stopProcess()
      }
    }
  }
}

async function workspaceClient(endpoint: Endpoint | null) {
  if (!endpoint) throw new Error("A browser Workspace can be attached only by a Client")

  const process = await endpoint.process()
  if (endpoint !== process.client) throw new Error("A browser Workspace can be attached only by a Client")

  const existing = clients.get(process.identity)
  if (existing) return existing

  const client = processClient(process)
  clients.set(process.identity, client)
  return client
}

async function releaseWorkspaceClient(endpoint: SystemEndpointEntity, listener: (client: string) => unknown) {
  const process = await endpoint.process()
  if (endpoint !== process.client || !clients.has(process.identity)) return

  clients.delete(process.identity)
  listener(process.identity)
}

async function processClient(process: Awaited<ReturnType<Endpoint["process"]>>): Promise<WorkspaceClient> {
  return {
    identity: process.identity,
    assignment: await process.option(browserWorkspaceOption),
    exited: () => process.exited(),
    exit: () => process.exit()
  }
}

function performInput(application: Application, request: BrowserInputRequest) {
  const workspace = application.workspace(request.workspace)

  switch (request.action) {
    case "session.select": return Promise.resolve(workspace.select(request.session))
    case "resize": return workspace.resize(request.session, request.viewport)
    case "pointer.click": return workspace.click(request.session, request.x, request.y, request.button ?? "left")
    case "wheel": return workspace.wheel(request.session, request.deltaX, request.deltaY)
    case "keyboard.type": return workspace.type(request.session, request.text)
    case "keyboard.press": return workspace.press(request.session, [...request.modifiers ?? [], request.key].join("+"))
  }
}
