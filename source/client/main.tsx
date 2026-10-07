import client from "react-dom/client"
import { StrictMode } from "react"
import View from "./view/view"

client.createRoot(document.body).render(<StrictMode><View /></StrictMode>)
