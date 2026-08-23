import client from "react-dom/client"
import { StrictMode } from "react"
import App from "./view/app"

client.createRoot(document.body).render(<StrictMode><App /></StrictMode>)
