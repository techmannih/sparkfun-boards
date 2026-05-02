import React from "react"
import { createRoot } from "react-dom/client"
import { RunFrame } from "@tscircuit/runframe/runner"

const LIVE_PREVIEW_TABS = ["pcb", "schematic", "cad", "errors"]

const getRootElement = () => {
  const existingRoot = document.getElementById("root")
  if (existingRoot) return existingRoot

  const root = document.createElement("div")
  root.id = "root"
  document.body.append(root)
  return root
}

const renderStatus = (message, tone = "accent") => {
  const palette =
    tone === "error"
      ? {
          border: "rgba(123, 47, 0, 0.24)",
          background: "rgba(255,255,255,0.92)",
          color: "#7b2f00",
        }
      : {
          border: "rgba(25, 30, 25, 0.12)",
          background: "rgba(255,255,255,0.82)",
          color: "#1d241f",
        }

  const root = getRootElement()
  root.innerHTML = `
    <div style="padding: 24px; border: 1px solid ${palette.border}; border-radius: 20px; background: ${palette.background}; color: ${palette.color}; font: 600 16px/1.6 'Segoe UI', sans-serif;">
      ${message}
    </div>
  `
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

const renderError = (message) => renderStatus(message, "error")

const bootstrap = () => {
  renderStatus("Loading live board preview...")

  const mainComponentPath = window.TSCIRCUIT_DEFAULT_MAIN_COMPONENT_PATH
  const runframeEntrypoint =
    window.TSCIRCUIT_RUNFRAME_ENTRYPOINT || window.TSCIRCUIT_DEFAULT_MAIN_COMPONENT_PATH

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
      availableTabs={LIVE_PREVIEW_TABS}
      defaultTab="pcb"
      enableFetchProxy
      entrypoint={runframeEntrypoint}
      fsMap={fsMap}
      mainComponentPath={mainComponentPath}
      showFileMenu={false}
      showToggleFullScreen
    />,
  )
}

window.addEventListener("error", (event) => {
  const message = event.error?.message ?? event.message ?? "Unknown viewer error"
  renderError(message)
})

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason)
  renderError(reason)
})

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrap, { once: true })
} else {
  bootstrap()
}
