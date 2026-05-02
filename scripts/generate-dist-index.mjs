import {
  access,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

const rootDir = process.cwd()
const boardsDir = path.join(rootDir, "boards")
const distDir = path.join(rootDir, "dist")

const importPattern =
  /\b(?:import|export)\s+(?:[^"'`]*?\s+from\s+)?["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const serializeJsonForScript = (value) =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("</script", "<\\/script")

const encodePathSegments = (value) =>
  value
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/")

const toRepoRelativePosix = (absolutePath) =>
  path.relative(rootDir, absolutePath).split(path.sep).join("/")

const fileExists = async (absolutePath) => {
  try {
    await access(absolutePath)
    return true
  } catch {
    return false
  }
}

const findSnapshotsDirectory = async (directory) => {
  const entries = await readdir(directory, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name)

    if (entry.isDirectory() && entry.name === "__snapshots__") {
      return fullPath
    }

    if (entry.isDirectory()) {
      const nestedMatch = await findSnapshotsDirectory(fullPath)
      if (nestedMatch) return nestedMatch
    }
  }

  return null
}

const markdownLinkPattern = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/i
const importExtensions = [".ts", ".tsx", ".js", ".jsx", ".json"]

const resolveRelativeImport = async (fromAbsolutePath, specifier) => {
  const baseCandidate = path.resolve(path.dirname(fromAbsolutePath), specifier)
  const hasExtension = path.extname(baseCandidate).length > 0
  const candidates = []

  if (hasExtension) {
    candidates.push(baseCandidate)
  } else {
    candidates.push(baseCandidate)
    for (const extension of importExtensions) {
      candidates.push(`${baseCandidate}${extension}`)
    }
    for (const extension of importExtensions) {
      candidates.push(path.join(baseCandidate, `index${extension}`))
    }
  }

  for (const candidate of candidates) {
    if (await fileExists(candidate)) return candidate
  }

  return null
}

const collectSourceFilesForEntrypoint = async (entrypointAbsolutePath, extraFiles = []) => {
  const sourceFiles = {}
  const visited = new Set()

  const visit = async (absolutePath) => {
    if (visited.has(absolutePath)) return
    visited.add(absolutePath)

    const content = await readFile(absolutePath, "utf8")
    sourceFiles[toRepoRelativePosix(absolutePath)] = content

    const matches = [...content.matchAll(importPattern)]
    for (const match of matches) {
      const specifier = match[1] ?? match[2]
      if (!specifier?.startsWith(".")) continue

      const resolvedPath = await resolveRelativeImport(absolutePath, specifier)
      if (!resolvedPath) continue

      await visit(resolvedPath)
    }
  }

  await visit(entrypointAbsolutePath)

  for (const extraFile of extraFiles) {
    if (!(await fileExists(extraFile))) continue
    if (visited.has(extraFile)) continue
    sourceFiles[toRepoRelativePosix(extraFile)] = await readFile(extraFile, "utf8")
  }

  return sourceFiles
}

const pickBoardEntrypoint = async (boardSourceDir) => {
  const entries = await readdir(boardSourceDir, { withFileTypes: true })
  const files = entries.filter((entry) => entry.isFile()).map((entry) => entry.name)

  const preferred =
    files.find((name) => name.endsWith(".circuit.tsx")) ||
    files.find((name) => name.endsWith(".circuiit.tsx")) ||
    files.find((name) => name === "index.tsx") ||
    files.find((name) => name === "index.ts") ||
    files.find((name) => name.endsWith(".tsx")) ||
    files.find((name) => name.endsWith(".ts")) ||
    null

  return preferred ? path.join(boardSourceDir, preferred) : null
}

const renderAssetActions = (board) =>
  [
    board.productUrl
      ? `<a href="${board.productUrl}" target="_blank" rel="noreferrer">Product Page</a>`
      : "",
    board.previewImage
      ? `<a href="${board.previewImageBoardRelative}" target="_blank" rel="noreferrer">Open 3D Preview</a>`
      : "",
    board.pcbSnapshot
      ? `<a href="${board.pcbSnapshotBoardRelative}" target="_blank" rel="noreferrer">Open PCB SVG</a>`
      : "",
    board.schematicSnapshot
      ? `<a href="${board.schematicSnapshotBoardRelative}" target="_blank" rel="noreferrer">Open Schematic SVG</a>`
      : "",
  ]
    .filter(Boolean)
    .join("")

const createFallbackTabs = (board) => {
  const tabs = []

  if (board.previewImage) tabs.push({ label: "3D Preview", src: board.previewImageBoardRelative })
  if (board.pcbSnapshot) tabs.push({ label: "PCB SVG", src: board.pcbSnapshotBoardRelative })
  if (board.schematicSnapshot) {
    tabs.push({ label: "Schematic SVG", src: board.schematicSnapshotBoardRelative })
  }

  return tabs
}

const renderBoardPage = (board) => {
  const fallbackTabs = createFallbackTabs(board)
  const defaultFallbackTab = fallbackTabs[0] ?? null
  const fallbackButtons = fallbackTabs
    .map(
      (tab, index) => `
            <button
              class="fallback-tab${index === 0 ? " is-active" : ""}"
              data-src="${tab.src}"
              data-label="${escapeHtml(tab.label)}"
            >
              ${escapeHtml(tab.label)}
            </button>`,
    )
    .join("")

  const boardActions = renderAssetActions(board)
  const serializedFsMap = serializeJsonForScript(board.fsMap)

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>${escapeHtml(board.title)} | SparkFun Boards</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f3ede3;
        --panel: rgba(255, 255, 255, 0.84);
        --panel-border: rgba(25, 30, 25, 0.1);
        --text: #1d241f;
        --muted: #5a655e;
        --accent: #cf4f00;
        --accent-strong: #7b2f00;
        --shadow: 0 24px 60px rgba(31, 35, 33, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(255, 171, 94, 0.24), transparent 30%),
          radial-gradient(circle at top right, rgba(111, 167, 141, 0.16), transparent 24%),
          linear-gradient(180deg, #fbf8f2 0%, var(--bg) 100%);
      }

      main {
        width: min(1260px, calc(100% - 32px));
        margin: 0 auto;
        padding: 28px 0 56px;
      }

      .back-link {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
        color: var(--accent-strong);
        text-decoration: none;
        font-weight: 700;
      }

      .layout {
        display: grid;
        grid-template-columns: minmax(280px, 360px) minmax(0, 1fr);
        gap: 20px;
      }

      .sidebar,
      .viewer-shell {
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        background: var(--panel);
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow);
      }

      .sidebar {
        padding: 24px;
      }

      .eyebrow {
        margin: 0 0 10px;
        color: var(--accent-strong);
        font-size: 0.8rem;
        font-weight: 800;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(1.9rem, 4vw, 3.2rem);
        line-height: 1.02;
        letter-spacing: -0.04em;
      }

      .sidebar p {
        margin: 0;
        color: var(--muted);
        line-height: 1.7;
      }

      .note {
        margin-top: 18px;
        padding: 14px 16px;
        border-radius: 18px;
        background: rgba(29, 36, 31, 0.05);
        font-size: 0.94rem;
      }

      .actions {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 22px;
      }

      .actions a {
        display: inline-flex;
        align-items: center;
        padding: 10px 13px;
        border-radius: 999px;
        background: rgba(207, 79, 0, 0.1);
        color: var(--accent);
        font-size: 0.9rem;
        font-weight: 700;
        text-decoration: none;
      }

      .actions a:hover,
      .actions a:focus-visible {
        background: rgba(207, 79, 0, 0.18);
        outline: none;
      }

      .viewer-shell {
        padding: 18px;
      }

      #root {
        min-height: 72vh;
        border-radius: 22px;
        overflow: hidden;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.8), rgba(244, 238, 230, 0.84)),
          linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(222, 214, 204, 0.55));
      }

      .fallback {
        margin-top: 16px;
        padding-top: 16px;
        border-top: 1px solid rgba(25, 30, 25, 0.08);
      }

      .fallback-header {
        margin: 0 0 10px;
        font-size: 0.96rem;
        font-weight: 700;
        color: var(--muted);
      }

      .fallback-toolbar {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-bottom: 14px;
      }

      .fallback-tab {
        border: 0;
        border-radius: 999px;
        padding: 10px 14px;
        background: rgba(29, 36, 31, 0.08);
        color: var(--text);
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }

      .fallback-tab.is-active {
        background: var(--accent);
        color: white;
      }

      .fallback-viewer {
        display: grid;
        place-items: center;
        min-height: 46vh;
        padding: 14px;
        border-radius: 22px;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.8), rgba(244, 238, 230, 0.84)),
          linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(222, 214, 204, 0.55));
      }

      .fallback-viewer img {
        display: block;
        max-width: 100%;
        max-height: calc(46vh - 28px);
        object-fit: contain;
        border-radius: 14px;
        box-shadow: 0 18px 36px rgba(31, 35, 33, 0.12);
        background: rgba(255, 255, 255, 0.85);
      }

      .fallback-caption {
        margin: 12px 4px 0;
        color: var(--muted);
        font-size: 0.92rem;
      }

      @media (max-width: 960px) {
        .layout {
          grid-template-columns: 1fr;
        }
      }

      @media (max-width: 640px) {
        main {
          width: min(100% - 20px, 1260px);
          padding-top: 20px;
          padding-bottom: 28px;
        }

        .sidebar,
        .viewer-shell,
        #root,
        .fallback-viewer {
          border-radius: 22px;
        }
      }
    </style>
    <script>
      window.TSCIRCUIT_DEFAULT_MAIN_COMPONENT_PATH = ${JSON.stringify(board.entrypoint)};
      window.TSCIRCUIT_PACKAGE_NAME = ${JSON.stringify(board.title)};

      ${
        board.entrypoint
          ? `
      {
        const params = new URLSearchParams(window.location.hash.slice(1));

        if (!params.get("file")) {
          params.set("file", ${JSON.stringify(board.entrypoint)});
          const nextHash = params.toString();
          window.history.replaceState(
            null,
            "",
            \`\${window.location.pathname}\${window.location.search}\${nextHash ? \`#\${nextHash}\` : ""}\`,
          );
        }
      }
      `
          : ""
      }
    </script>
  </head>
  <body>
    <main>
      <a class="back-link" href="../../">← Back to all boards</a>
      <section class="layout">
        <aside class="sidebar">
          <p class="eyebrow">${escapeHtml(board.directoryName)}</p>
          <h1>${escapeHtml(board.title)}</h1>
          <p>
            This page embeds the runframe standalone viewer with the board source
            files baked into the HTML, which is the closest deploy-safe equivalent
            to the local <code>bun run start</code> preview.
          </p>
          <div class="note">
            The runframe viewer below gets this board's source files directly from
            the page, so it does not depend on the local-only <code>/api</code>
            file server used by <code>tsci dev</code>.
          </div>
          <div class="actions">
            ${boardActions}
          </div>
        </aside>
        <section class="viewer-shell">
          <div id="root"></div>
          ${
            defaultFallbackTab
              ? `
          <section class="fallback">
            <p class="fallback-header">Fallback committed snapshots</p>
            <div class="fallback-toolbar">
              ${fallbackButtons}
            </div>
            <div class="fallback-viewer">
              <img
                id="fallback-image"
                src="${defaultFallbackTab.src}"
                alt="${escapeHtml(board.title)} ${escapeHtml(defaultFallbackTab.label)}"
              />
            </div>
            <p class="fallback-caption" id="fallback-caption">
              ${escapeHtml(defaultFallbackTab.label)}
            </p>
          </section>`
              : ""
          }
        </section>
      </section>
    </main>
    <script id="board-fsmap" type="application/json">${serializedFsMap}</script>
    <script type="module" src="../../vendor/runframe-static-viewer.js"></script>
    <script>
      const fallbackButtons = Array.from(document.querySelectorAll(".fallback-tab"));
      const fallbackImage = document.getElementById("fallback-image");
      const fallbackCaption = document.getElementById("fallback-caption");

      for (const button of fallbackButtons) {
        button.addEventListener("click", () => {
          const src = button.dataset.src;
          const label = button.dataset.label;

          if (!src || !fallbackImage || !fallbackCaption) return;

          fallbackImage.src = src;
          fallbackImage.alt = ${JSON.stringify(board.title)} + " " + label;
          fallbackCaption.textContent = label;

          for (const candidate of fallbackButtons) {
            candidate.classList.remove("is-active");
          }

          button.classList.add("is-active");
        });
      }
    </script>
  </body>
</html>
`
}

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

const vendorDir = path.join(distDir, "vendor")
await mkdir(vendorDir, { recursive: true })

const boardDirectories = await readdir(boardsDir, { withFileTypes: true })
const boardEntries = []

for (const board of boardDirectories) {
  if (!board.isDirectory()) continue

  const boardSourceDir = path.join(boardsDir, board.name)
  const readmePath = path.join(boardSourceDir, "README.md")
  const boardEntrypointAbsolutePath = await pickBoardEntrypoint(boardSourceDir)

  let readme = ""
  try {
    readme = await readFile(readmePath, "utf8")
  } catch {
    readme = ""
  }

  const titleMatch = readme.match(/^#\s+(.+)$/m)
  const title = titleMatch?.[1]?.trim() || board.name

  const productUrlMatch = readme.match(markdownLinkPattern)
  const productUrl = productUrlMatch?.[1] ?? null

  const snapshotsDir = await findSnapshotsDirectory(boardSourceDir)
  const boardPageDir = path.join(distDir, "boards", board.name)
  await mkdir(boardPageDir, { recursive: true })

  const snapshotFiles = []

  if (snapshotsDir) {
    const distAssetDir = path.join(distDir, "assets", board.name)
    await mkdir(distAssetDir, { recursive: true })

    const snapshots = await readdir(snapshotsDir, { withFileTypes: true })
    for (const snapshot of snapshots) {
      if (!snapshot.isFile()) continue

      const sourcePath = path.join(snapshotsDir, snapshot.name)
      const destinationPath = path.join(distAssetDir, snapshot.name)

      await copyFile(sourcePath, destinationPath)
      snapshotFiles.push({
        name: snapshot.name,
        hrefFromIndex: encodePathSegments(path.relative(distDir, destinationPath)),
        hrefFromBoardPage: encodePathSegments(
          path.relative(boardPageDir, destinationPath),
        ),
      })
    }
  }

  snapshotFiles.sort((left, right) => left.name.localeCompare(right.name))

  const fsMap = boardEntrypointAbsolutePath
    ? await collectSourceFilesForEntrypoint(boardEntrypointAbsolutePath, [
        path.join(rootDir, "tsconfig.json"),
      ])
    : {}

  const boardEntry = {
    directoryName: board.name,
    title,
    productUrl,
    href: `${encodePathSegments(path.relative(distDir, boardPageDir))}/`,
    entrypoint: boardEntrypointAbsolutePath
      ? toRepoRelativePosix(boardEntrypointAbsolutePath)
      : null,
    fsMap,
    previewImage:
      snapshotFiles.find((file) => file.name.endsWith(".png"))?.hrefFromIndex ?? null,
    previewImageBoardRelative:
      snapshotFiles.find((file) => file.name.endsWith(".png"))?.hrefFromBoardPage ?? null,
    pcbSnapshot:
      snapshotFiles.find((file) => file.name.includes("pcb") && file.name.endsWith(".svg"))
        ?.hrefFromIndex ?? null,
    pcbSnapshotBoardRelative:
      snapshotFiles.find((file) => file.name.includes("pcb") && file.name.endsWith(".svg"))
        ?.hrefFromBoardPage ?? null,
    schematicSnapshot:
      snapshotFiles.find(
        (file) => file.name.includes("schematic") && file.name.endsWith(".svg"),
      )?.hrefFromIndex ?? null,
    schematicSnapshotBoardRelative:
      snapshotFiles.find(
        (file) => file.name.includes("schematic") && file.name.endsWith(".svg"),
      )?.hrefFromBoardPage ?? null,
  }

  boardEntries.push(boardEntry)
  await writeFile(path.join(boardPageDir, "index.html"), renderBoardPage(boardEntry))
}

boardEntries.sort((left, right) => left.title.localeCompare(right.title))

const totalBoards = boardEntries.length.toLocaleString("en-US")

const boardListMarkup = boardEntries
  .map(
    (board) => `
      <li class="board-card">
        <a class="board-card-link" href="${board.href}">
          <div class="preview">
            ${
              board.previewImage
                ? `<img src="${board.previewImage}" alt="${escapeHtml(board.title)} 3D preview" loading="lazy" />`
                : `<div class="preview-placeholder">No 3D preview committed</div>`
            }
          </div>
          <div class="board-copy">
            <p class="board-kicker">${escapeHtml(board.directoryName)}</p>
            <h2>${escapeHtml(board.title)}</h2>
            <p class="board-summary">
              Open the live runframe board preview, with committed snapshot assets still available below it.
            </p>
            <span class="board-cta">Open live board preview</span>
          </div>
        </a>
      </li>`,
  )
  .join("")

const indexHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta
      name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover"
    />
    <title>SparkFun Boards</title>
    <style>
      :root {
        color-scheme: light;
        --bg: #f4efe7;
        --panel: rgba(255, 255, 255, 0.78);
        --panel-border: rgba(24, 28, 27, 0.09);
        --text: #1d241f;
        --muted: #5a655e;
        --accent: #cf4f00;
        --accent-strong: #7b2f00;
        --shadow: 0 24px 60px rgba(31, 35, 33, 0.12);
      }

      * {
        box-sizing: border-box;
      }

      body {
        margin: 0;
        min-height: 100vh;
        font-family: "Segoe UI", "Helvetica Neue", Arial, sans-serif;
        color: var(--text);
        background:
          radial-gradient(circle at top left, rgba(255, 171, 94, 0.28), transparent 30%),
          radial-gradient(circle at top right, rgba(111, 167, 141, 0.18), transparent 24%),
          linear-gradient(180deg, #fbf8f2 0%, var(--bg) 100%);
      }

      main {
        width: min(1120px, calc(100% - 32px));
        margin: 0 auto;
        padding: 56px 0 72px;
      }

      .hero {
        padding: 32px;
        border: 1px solid var(--panel-border);
        border-radius: 28px;
        background: var(--panel);
        backdrop-filter: blur(10px);
        box-shadow: var(--shadow);
      }

      .eyebrow {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        margin-bottom: 18px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(207, 79, 0, 0.1);
        color: var(--accent-strong);
        font-size: 0.86rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      h1 {
        margin: 0 0 12px;
        font-size: clamp(2.2rem, 6vw, 4.5rem);
        line-height: 0.95;
        letter-spacing: -0.05em;
      }

      .hero p {
        max-width: 760px;
        margin: 0;
        font-size: 1.02rem;
        line-height: 1.7;
        color: var(--muted);
      }

      .stats {
        display: inline-flex;
        margin-top: 22px;
        padding: 12px 16px;
        border-radius: 18px;
        background: rgba(29, 36, 31, 0.05);
        color: var(--text);
        font-size: 0.96rem;
        font-weight: 600;
      }

      .toolbar {
        margin-top: 24px;
      }

      .toolbar input {
        width: min(420px, 100%);
        padding: 14px 16px;
        border: 1px solid rgba(29, 36, 31, 0.14);
        border-radius: 16px;
        background: rgba(255, 255, 255, 0.92);
        color: var(--text);
        font: inherit;
      }

      .boards {
        list-style: none;
        margin: 26px 0 0;
        padding: 0;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
        gap: 14px;
      }

      .board-card-link {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        border: 1px solid rgba(29, 36, 31, 0.08);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 10px 28px rgba(31, 35, 33, 0.08);
        overflow: hidden;
        text-decoration: none;
        transition:
          transform 160ms ease,
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      .board-card-link:hover,
      .board-card-link:focus-visible {
        transform: translateY(-2px);
        border-color: rgba(207, 79, 0, 0.34);
        box-shadow: 0 18px 38px rgba(31, 35, 33, 0.12);
        outline: none;
      }

      .preview {
        aspect-ratio: 4 / 3;
        background:
          radial-gradient(circle at top, rgba(255, 255, 255, 0.86), rgba(245, 240, 234, 0.78)),
          linear-gradient(180deg, rgba(255, 255, 255, 0.4), rgba(222, 214, 204, 0.55));
      }

      .preview img,
      .preview-placeholder {
        width: 100%;
        height: 100%;
      }

      .preview img {
        display: block;
        object-fit: cover;
      }

      .preview-placeholder {
        display: grid;
        place-items: center;
        padding: 16px;
        color: var(--muted);
        text-align: center;
        font-weight: 600;
      }

      .board-copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        gap: 14px;
        padding: 18px;
      }

      .board-kicker {
        margin: 0;
        color: var(--accent-strong);
        font-size: 0.8rem;
        font-weight: 700;
        letter-spacing: 0.03em;
        text-transform: uppercase;
      }

      .board-copy h2 {
        margin: 0;
        color: var(--text);
        font-size: 1.03rem;
        line-height: 1.45;
      }

      .board-summary {
        margin: 0;
        color: var(--muted);
        font-size: 0.95rem;
        line-height: 1.6;
      }

      .board-cta {
        margin-top: auto;
        color: var(--accent);
        font-size: 0.88rem;
        font-weight: 800;
        letter-spacing: 0.02em;
      }

      @media (max-width: 640px) {
        main {
          width: min(100% - 20px, 1120px);
          padding-top: 24px;
          padding-bottom: 28px;
        }

        .hero {
          padding: 22px;
          border-radius: 22px;
        }
      }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <div class="eyebrow">SparkFun Board Library</div>
        <h1>Live board previews for deployment</h1>
        <p>
          Click any board card to open a deploy-safe live board preview powered by
          the runframe standalone viewer, with committed snapshots still available
          on each page as a fallback.
        </p>
        <div class="stats">${totalBoards} board viewers published</div>
        <div class="toolbar">
          <input id="search" type="search" placeholder="Filter boards by name..." />
        </div>
        <ul class="boards">
${boardListMarkup}
        </ul>
      </section>
    </main>
    <script>
      const searchInput = document.getElementById("search");
      const cards = Array.from(document.querySelectorAll(".board-card"));

      searchInput?.addEventListener("input", (event) => {
        const query = event.target.value.trim().toLowerCase();

        for (const card of cards) {
          const text = card.textContent.toLowerCase();
          card.hidden = query.length > 0 && !text.includes(query);
        }
      });
    </script>
  </body>
</html>
`

await writeFile(path.join(distDir, "index.html"), indexHtml)
