import React from "react"
import { createRoot } from "react-dom/client"
import { RunFrame } from "@tscircuit/runframe/runner"

const getRootElement = () => {
  const existingRoot = document.getElementById("root")
  if (existingRoot) return existingRoot

  const root = document.createElement("div")
  root.id = "root"
  document.body.append(root)
  return root
}

const parseBoardFsMap = () => {
  const fsMapScript = document.getElementById("board-fsmap")
  if (!fsMapScript) {
    throw new Error("Could not find the embedded board source map.")
  }

  const json = fsMapScript.textContent ?? ""
  const parsed = JSON.parse(json)

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Embedded board source map is invalid.")
  }

  return parsed
}

const renderError = (message) => {
  const root = getRootElement()
  root.innerHTML = `
    <div style="padding: 24px; border-radius: 20px; background: rgba(255,255,255,0.88); color: #7b2f00; font: 600 16px/1.6 'Segoe UI', sans-serif;">
      ${message}
    </div>
  `
}

const bootstrap = () => {
  const mainComponentPath = window.TSCIRCUIT_DEFAULT_MAIN_COMPONENT_PATH

  if (!mainComponentPath) {
    renderError("This board page is missing its main component path.")
    return
  }

  let fsMap
  try {
    fsMap = parseBoardFsMap()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    renderError(message)
    return
  }

  const root = createRoot(getRootElement())

  root.render(
    <RunFrame
      defaultTab="pcb"
      enableFetchProxy
      entrypoint={mainComponentPath}
      fsMap={fsMap}
      mainComponentPath={mainComponentPath}
      showFileMenu
      showToggleFullScreen
    />,
  )
}

bootstrap()
