import { randomUUID } from "node:crypto"
import type { Endpoint } from "@phreshos/core"
import { context } from "@phreshos/server"
import type { ApplicationEvent } from "../core/application"
import type { WorkspaceClient, WorkspaceClients } from "../core/application"
import Application from "../core/application"
import type { BrowserFrame } from "../core/browser-engine"
import type { TabFrame, TabObservationFrame } from "../../shared/browser"
import { requests, type BrowserRequests, type BrowserServiceEvents } from "../../shared/service"

type Message = Readonly<{ payload: unknown, from?: Endpoint | null }>

export interface ServiceBoundary {
  answer(event: string, handler: (message: Message) => unknown): void
  publish(event: string, payload: unknown): void
}

export function workspaceClients(): WorkspaceClients {
  return {
    async create(workspace) {
      const program = await context.program()
      return processClient(await program.createProcess({
        server: false,
        client: true,
        options: { workspace }
      }))
    }
  }
}

/** Exposes the browser domain without giving transport concerns to its entities. */
export function serve(application: Application, boundary: ServiceBoundary = context) {
  const observations = new Map<string, Observation>()
  application.subscribe(event => {
    publish(boundary, event)
    closeMissingObservations(observations, event)
  })

  answer(boundary, "workspace.attach", async (_payload, message) => {
    return (await application.attachClient(await messageClient(message))).snapshot()
  })
  answer(boundary, "workspace.list", async () => application.listWorkspaces())
  answer(boundary, "workspace.create", async () => (await application.createWorkspace()).snapshot())
  answer(boundary, "workspace.read", async payload => application.workspace(requests.workspace.parse(payload).workspace).snapshot())
  answer(boundary, "workspace.close", async payload => {
    await application.closeWorkspace(requests.workspace.parse(payload).workspace)
    return null
  })
  answer(boundary, "tab.create", async payload => {
    const request = requests.tabCreate.parse(payload)
    return application.workspace(request.workspace).createTab(request.viewport)
  })
  answer(boundary, "tab.close", async payload => {
    const request = requests.tab.parse(payload)
    await application.workspace(request.workspace).closeTab(request.tab)
    return null
  })
  answer(boundary, "tab.select", async payload => {
    const request = requests.tab.parse(payload)
    await application.workspace(request.workspace).selectTab(request.tab)
    return null
  })
  answer(boundary, "tab.navigate", async payload => {
    const request = requests.navigate.parse(payload)
    return application.workspace(request.workspace).navigate(request.tab, request.url)
  })
  answer(boundary, "tab.back", payload => operation(application, payload, "back"))
  answer(boundary, "tab.forward", payload => operation(application, payload, "forward"))
  answer(boundary, "tab.reload", payload => operation(application, payload, "reload"))
  answer(boundary, "tab.capture", async payload => {
    const request = requests.tab.parse(payload)
    return application.workspace(request.workspace).capture(request.tab)
  })
  answer(boundary, "tab.observe", async (payload, message) => {
    const request = requests.tab.parse(payload)
    const owner = requireOwner(message)
    const workspace = application.workspace(request.workspace)
    const observation: Observation = {
      id: randomUUID(),
      workspace: request.workspace,
      tab: request.tab,
      owner,
      sequence: 1,
      inFlight: true,
      pending: null,
      releaseFrames: () => undefined,
      releaseOwner: () => undefined,
      closed: false
    }

    observation.releaseFrames = await workspace.observeFrames(request.tab, frame => queueFrame(boundary, observation, frame))
    observation.releaseOwner = owner.lifecycle.subscribe("stop", () => closeObservation(observations, observation))
    observations.set(observation.id, observation)

    try {
      return observed(observation, await workspace.capture(request.tab))
    } catch (error) {
      closeObservation(observations, observation)
      throw error
    }
  })
  answer(boundary, "tab.acknowledge", async (payload, message) => {
    const request = requests.acknowledge.parse(payload)
    const observation = requireObservation(observations, request.observation, message)
    if (!observation.inFlight || request.sequence !== observation.sequence) {
      throw new Error("The browser Tab frame acknowledgement is not current")
    }

    observation.inFlight = false
    flushFrame(boundary, observation)
    return null
  })
  answer(boundary, "tab.unobserve", async (payload, message) => {
    const request = requests.observation.parse(payload)
    closeObservation(observations, requireObservation(observations, request.observation, message))
    return null
  })
  answer(boundary, "tab.resize", async payload => {
    const request = requests.resize.parse(payload)
    return application.workspace(request.workspace).resize(request.tab, request.viewport)
  })
  answer(boundary, "tab.movePointer", async payload => {
    const request = requests.point.parse(payload)
    return application.workspace(request.workspace).movePointer(request.tab, request.x, request.y)
  })
  answer(boundary, "tab.click", async payload => {
    const request = requests.click.parse(payload)
    return application.workspace(request.workspace).click(request.tab, request.x, request.y, request.button)
  })
  answer(boundary, "tab.wheel", async payload => {
    const request = requests.wheel.parse(payload)
    return application.workspace(request.workspace).wheel(request.tab, request.deltaX, request.deltaY)
  })
  answer(boundary, "tab.type", async payload => {
    const request = requests.type.parse(payload)
    return application.workspace(request.workspace).type(request.tab, request.text)
  })
  answer(boundary, "tab.press", async payload => {
    const request = requests.press.parse(payload)
    return application.workspace(request.workspace).press(request.tab, request.key, request.modifiers)
  })
}

async function messageClient(message: Message) {
  if (!message.from) throw new Error("A browser Workspace can be attached only by a Client")
  const process = await message.from.process()
  if (message.from !== process.client) throw new Error("A browser Workspace can be attached only by a Client")
  return processClient(process)
}

async function processClient(process: Awaited<ReturnType<Endpoint["process"]>>): Promise<WorkspaceClient> {
  return {
    identity: process.identity,
    assignment: await process.options<string>("workspace"),
    subscribeExit: listener => process.subscribe("exit", () => { listener() }),
    exited: () => process.exited(),
    exit: () => process.exit()
  }
}

function answer<Event extends keyof BrowserRequests>(
  boundary: ServiceBoundary,
  event: Event,
  handler: (payload: BrowserRequests[Event]["input"], message: Message) => Promise<BrowserRequests[Event]["output"]>
) {
  boundary.answer(event, message => handler(message.payload as BrowserRequests[Event]["input"], message))
}

function operation(application: Application, payload: unknown, action: "back" | "forward" | "reload") {
  const request = requests.tab.parse(payload)
  return application.workspace(request.workspace)[action](request.tab)
}

type Observation = {
  readonly id: string
  readonly workspace: string
  readonly tab: string
  readonly owner: Endpoint
  sequence: number
  inFlight: boolean
  pending: BrowserFrame | null
  releaseFrames: () => void
  releaseOwner: () => void
  closed: boolean
}

function requireOwner(message: Message) {
  if (!message.from) throw new Error("Continuous browser Tab observation requires a Client Endpoint")
  return message.from
}

function requireObservation(observations: Map<string, Observation>, id: string, message: Message) {
  const observation = observations.get(id)
  if (!observation || observation.owner !== requireOwner(message)) {
    throw new Error("The browser Tab observation does not exist")
  }
  return observation
}

function queueFrame(boundary: ServiceBoundary, observation: Observation, frame: BrowserFrame) {
  if (observation.closed) return
  // Retain only the newest undisplayed frame so a slow Client cannot build an unbounded transport queue.
  observation.pending = frame
  flushFrame(boundary, observation)
}

function flushFrame(boundary: ServiceBoundary, observation: Observation) {
  if (observation.closed || observation.inFlight || !observation.pending) return
  const frame = observation.pending
  observation.pending = null
  observation.inFlight = true
  observation.sequence += 1
  boundary.publish("tab.frame" satisfies keyof BrowserServiceEvents, observed(observation, frame))
}

function observed(observation: Observation, frame: TabFrame | BrowserFrame): TabObservationFrame {
  return Object.freeze({
    observation: observation.id,
    sequence: observation.sequence,
    tab: observation.tab,
    viewport: frame.viewport,
    mimeType: "mimeType" in frame ? frame.mimeType : "image/jpeg",
    data: frame.data
  })
}

function closeObservation(observations: Map<string, Observation>, observation: Observation) {
  if (observation.closed) return
  observation.closed = true
  observations.delete(observation.id)
  observation.pending = null
  observation.releaseFrames()
  observation.releaseOwner()
}

function closeMissingObservations(observations: Map<string, Observation>, event: ApplicationEvent) {
  for (const observation of observations.values()) {
    if (event.type === "workspace.closed" && observation.workspace === event.workspace
      || event.type === "workspace.changed" && observation.workspace === event.snapshot.id
        && !event.snapshot.tabs.some(tab => tab.id === observation.tab)) {
      closeObservation(observations, observation)
    }
  }
}

function publish(boundary: ServiceBoundary, event: ApplicationEvent) {
  if (event.type === "workspace.changed") {
    boundary.publish("workspace.changed" satisfies keyof BrowserServiceEvents, event.snapshot)
  } else {
    boundary.publish("workspace.closed" satisfies keyof BrowserServiceEvents, { workspace: event.workspace })
  }
}
