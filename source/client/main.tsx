import client from "react-dom/client"
import { StrictMode } from "react"
import App from "./view/app"
import "./style.css"

client.createRoot(document.body).render(<StrictMode><App /></StrictMode>)
