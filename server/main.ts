import Application from "./core/application"
import ChromiumEngine from "./core/chromium"
import { serve, workspaceClients } from "./view/service"

const application = new Application(new ChromiumEngine(), workspaceClients())

serve(application)
process.once("exit", () => { void application.dispose() })
