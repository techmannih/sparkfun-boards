import {
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

const escapeHtml = (value) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const encodePathSegments = (value) =>
  value
    .split(path.sep)
    .map((segment) => encodeURIComponent(segment))
    .join("/")

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

await rm(distDir, { recursive: true, force: true })
await mkdir(distDir, { recursive: true })

const boardDirectories = await readdir(boardsDir, { withFileTypes: true })
const boardEntries = []

for (const board of boardDirectories) {
  if (!board.isDirectory()) continue

  const boardSourceDir = path.join(boardsDir, board.name)
  const readmePath = path.join(boardSourceDir, "README.md")

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
        href: encodePathSegments(path.relative(distDir, destinationPath)),
      })
    }
  }

  snapshotFiles.sort((left, right) => left.name.localeCompare(right.name))

  boardEntries.push({
    directoryName: board.name,
    title,
    productUrl,
    previewImage:
      snapshotFiles.find((file) => file.name.endsWith(".png"))?.href ?? null,
    pcbSnapshot:
      snapshotFiles.find((file) => file.name.includes("pcb") && file.name.endsWith(".svg"))
        ?.href ?? null,
    schematicSnapshot:
      snapshotFiles.find(
        (file) => file.name.includes("schematic") && file.name.endsWith(".svg"),
      )?.href ?? null,
  })
}

boardEntries.sort((left, right) => left.title.localeCompare(right.title))

const totalBoards = boardEntries.length.toLocaleString("en-US")

const boardListMarkup = boardEntries
  .map(
    (board) => `
      <li class="board-card">
        <article>
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
            <div class="board-links">
              ${
                board.productUrl
                  ? `<a href="${board.productUrl}" target="_blank" rel="noreferrer">Product Page</a>`
                  : ""
              }
              ${
                board.pcbSnapshot
                  ? `<a href="${board.pcbSnapshot}" target="_blank" rel="noreferrer">PCB SVG</a>`
                  : ""
              }
              ${
                board.schematicSnapshot
                  ? `<a href="${board.schematicSnapshot}" target="_blank" rel="noreferrer">Schematic SVG</a>`
                  : ""
              }
            </div>
          </div>
        </article>
      </li>`,
  )
  .join("")

const html = `<!doctype html>
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

      .board-card article {
        display: flex;
        flex-direction: column;
        min-height: 100%;
        border: 1px solid rgba(29, 36, 31, 0.08);
        border-radius: 22px;
        background: rgba(255, 255, 255, 0.86);
        box-shadow: 0 10px 28px rgba(31, 35, 33, 0.08);
        overflow: hidden;
        transition:
          transform 160ms ease,
          border-color 160ms ease,
          box-shadow 160ms ease;
      }

      .board-card article:hover {
        transform: translateY(-2px);
        border-color: rgba(207, 79, 0, 0.34);
        box-shadow: 0 18px 38px rgba(31, 35, 33, 0.12);
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
        font-size: 1.03rem;
        line-height: 1.45;
      }

      .board-links {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: auto;
      }

      .board-links a {
        display: inline-flex;
        align-items: center;
        padding: 9px 12px;
        border-radius: 999px;
        background: rgba(207, 79, 0, 0.1);
        color: var(--accent);
        font-size: 0.88rem;
        font-weight: 700;
        text-decoration: none;
      }

      .board-links a:hover,
      .board-links a:focus-visible {
        background: rgba(207, 79, 0, 0.18);
        outline: none;
      }

      code {
        font-family: "SFMono-Regular", "Consolas", "Liberation Mono", monospace;
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
        <h1>Snapshot gallery ready for deployment</h1>
        <p>
          This deployment publishes a browsable gallery built from the committed
          README metadata and board snapshots in this repository. Filter by name
          and open product pages, PCB SVGs, or schematic SVGs directly from each
          card.
        </p>
        <div class="stats">${totalBoards} board previews published</div>
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

await writeFile(path.join(distDir, "index.html"), html)
