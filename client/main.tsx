import { StrictMode } from "react"
import client from "react-dom/client"
import App from "./app"
import Application from "./core/application"
import { connect } from "./view/connection"
import "./style.css"

const container = document.createElement("div")
container.id = "root"
document.body.append(container)
const root = client.createRoot(container)
const application = new Application(connect())

// The browser projection belongs to this iframe document, not to a React
// mount. Strict Mode may replay component lifecycles, but it must not create a
// second authoritative Workspace.
void application.start().catch(error => application.fail(error))
globalThis.addEventListener("pagehide", () => application.dispose(), { once: true })

root.render(<StrictMode><App application={application} /></StrictMode>)
