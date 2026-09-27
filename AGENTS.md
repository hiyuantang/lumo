# Lumo — Agent Guide

## License (IMPORTANT — read before editing)

Lumo is licensed under the **GNU Affero General Public License v3 only**
(`AGPL-3.0-only`), NOT `AGPL-3.0-or-later`.

- The [LICENSE](LICENSE) file is the FSF's standard AGPL-3.0 text. The
  "or any later version" paragraph near the end is part of the FSF's
  *How to Apply These Terms* appendix — it is a **sample notice**, not a
  binding choice. Do not treat the project as "or later".
- The authoritative choice is declared by:
  1. The `## License` section in [README.md](README.md)
  2. `"license": "AGPL-3.0-only"` in [package.json](package.json)
  3. Per-file SPDX headers (see below)
- SPDX distinguishes `AGPL-3.0-only` from `AGPL-3.0-or-later`; the project
  uses the former.

### Rules

- **Never** modify the [LICENSE](LICENSE) file. It must stay byte-for-byte
  identical to the FSF's AGPL-3.0 text.
- **Never** add GPL/LGPL/MIT/Apache or any other license to the repository
  without explicit user approval.
- **Never** add a "or any later version" clause or `AGPL-3.0-or-later`
  anywhere. The choice is v3-only.
- Any new `package.json` (or equivalent manifest) **must** set
  `"license": "AGPL-3.0-only"`.

### Per-file SPDX headers

New source files **should** carry the SPDX header on the first line:

```ts
// SPDX-License-Identifier: AGPL-3.0-only
```

```py
# SPDX-License-Identifier: AGPL-3.0-only
```

When creating a new file, match the comment style of nearby files and
include the header. Do not remove existing SPDX headers when editing.

### Future: web interface

When a web UI exists, add an About → Legal page covering:

- **Source Code** — link to the repository
- **License** — AGPL-3.0-only, with a link to [LICENSE](LICENSE)
- **No Warranty** — AGPL-3.0 §15 / §16 disclaimer

This page is also the natural place to host the source-code offer
required by AGPL-3.0 §13 for modified versions used over a network.

## Coding conventions

- Do not add license headers other than the SPDX line above.
- Do not add inline comments unless explicitly requested.
- Match the style of neighboring files; do not introduce new frameworks
  without checking the project first.

## UI design rules

Apply these rules to every UI change. See [DESKTOP_STYLE.md](docs/DESKTOP_STYLE.md)
for visual details and [DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md) for
interaction and accessibility requirements.

- **Use space efficiently.** Keep actions beside the heading or content they
  affect. A single Edit or Refresh button must not consume a whole row.
  Avoid duplicate information, redundant controls and unnecessary metadata.
- **Keep navigation compact.** Put Back and Forward on the left, followed by
  the current page or folder name. Move lengthy details to a separate page.
  Use distinct icons for navigation, sidebar toggling and other actions.
- **Scope controls locally.** Search belongs above the list it filters. Put
  compact Refresh controls in the left panel or card header; App Library uses
  View → Refresh. Do not add unexplained refresh icons or extra update buttons.
- **Size cards consistently.** Use adaptive grids: typically two app cards
  across, with more or fewer as the window changes. Cap card height and clamp
  long descriptions with an ellipsis; keep full content on the details page.
- **Keep detail headers simple.** Show the content's own title and description,
  with Edit on the right, then one divider and the body. Avoid repeating the
  title or adding a separate action row. Skills render by default; Edit opens
  Preview. Do not add Raw/Rendered controls to Skills.
- **Keep Files concise.** Show only the current folder name in the toolbar.
  Keep the full path below, with clickable folder segments and Copy on the
  right; no path-edit field. Preserve List/Grid views and sorting choices.
- **Make menus consistent.** Left-align labels with a fixed checkmark column.
  Clicking outside a menu, including inside another app, dismisses it and
  performs the clicked action.
- **Use direct update flows.** App Library has Discovery and Updates. Offer
  Update per app and Update all. Completed updates move to installed history,
  showing old version → new version without an extra disclosure step.
- **Use consistent names.** Match names across the dock, menus and App Library
  (for example, Docker and Nginx). Omit incidental engine/demo labels from
  everyday controls; show version details where they help with updates.
- **Keep surfaces neutral and matte.** Light mode uses white and grey; dark
  mode uses near-black and charcoal. Buttons have a soft matte finish without
  glossy gradients, bevels or plastic highlights. App icons are colorful,
  minimalist and original. The desktop menu bar is transparent with no bottom
  separator.
- **Keep window controls small and clear.** Circular coral, amber and green
  controls belong at the top left, with readable, sufficiently bold glyphs.
- **Coordinate motion.** Transitions should feel smooth and explain state.
  A dock thumbnail disappears as its window restores, without lingering as
  a duplicate. Preserve window state and respect reduced motion. Verify UI
  changes in both themes and at normal and narrow window sizes as applicable.

## Development

The repository root is a Vite + React + TypeScript application (strict
mode, no UI component library, plain CSS with design tokens in
`src/styles/tokens.css`). The server is Go (project-local toolchain in
`.tools/`, gitignored; run `go` as `.tools/go/bin/go` with
`GOMODCACHE`, `GOCACHE`, `GOPATH` all set under `.tools/`).

Frontend:

- `npm install` — install dependencies.
- `npm run dev` — dev server with mock data (default).
- `npm run dev:live` — dev server against a running `lumod`
  (proxies `/api`, including WebSocket, to `127.0.0.1:8080`).
- `npm run build` — typecheck (`tsc --noEmit`) and build. Must pass
  clean before any change is considered done. Production builds default
  to live mode; `npm run build:mock` forces mock.
- `npm test` / `npm run test:ui` — visual and interaction tests with simulated
  data (Chromium; one-time setup via `npx playwright install chromium`).
- `npm run test:docker` — real Ubuntu operations and browser-to-Ubuntu workflows.
- `npm run test:unit` — Go and installer unit checks.
- `npm run test:all` — build, unit, interface and Docker gates.
- See `docs/TESTING.md` for coverage boundaries and screenshot baselines.

Backend (`server/` module `lumo/server`):

- `cd server && go test ./...` — unit tests (run on macOS).
- `scripts/integration-test.sh` — builds the live frontend and PAM-enabled
  backend, runs Linux Go tests, then checks REST, WebSocket and browser
  workflows in a disposable privileged systemd Ubuntu 24.04 container.
  Requires Docker; follows the Docker engine architecture.
- `scripts/build-with-web.sh` — build `server/bin/lumod` with the
  frontend embedded (`-tags webdist`).
- `lumod gateway` binds `127.0.0.1:8080` by default and authenticates
  through `sessiond`. The wire contract is `docs/PROTOCOL.md`; implement
  from it, not from other projects.

Layout:

- `src/shell/` — desktop shell (window manager, menu bar, dock, command
  center, notification center, login).
- `src/apps/` — applications rendered inside shell windows.
- `src/api/` — typed data-source seam + live protocol client.
- `src/mock/` — mock implementation of the seam. Apps must read system
  state only through the seam (`src/api/source.ts`); never call `fetch`
  directly from components.
- `server/cmd/lumod/` — the agent binary. Subcommands: `gateway`
  (unprivileged web frontend), `sessiond` (root, PAM + spawns per-user
  agents), `agent` (per-user worker, runs as the real UID), `broker`
  (root, typed privileged actions + polkit + audit). No subcommand runs
  the legacy single-process unauthenticated mode for local dev.
- `server/internal/` — auth, broker, files, gateway, httpapi, ipc,
  journal, sessiond, services, system, terminal, wsapi.
- `docker/` — systemd test image; `scripts/` — build and test scripts.
- `tests/ui/` — visual and interaction checks with simulated responses.
- `tests/docker/` — real Ubuntu API and browser workflows.

UI checks use `data-testid` hooks; keep existing testids stable and add
new ones for new interactive elements.

## Project mission

Build an independent, web-native desktop for administering headless Ubuntu
servers. The browser renders the desktop, applications, windows, menus and
animations locally. The server exposes typed system capabilities and streams
state changes.

The product must feel calm and desktop-native, inspired by macOS interaction
principles, but must use original branding, visual assets, typography,
components, layouts and implementation.

## Clean-room rules

1. This is an independent implementation.
2. Do not clone, open, search, fetch or inspect third-party public
   repositories for implementation reference.
3. Do not reproduce source code, tests, CSS, assets, DOM structure,
   comments, strings, internal identifiers or undocumented protocols from
   other projects.
4. Do not translate another project's code into another language.
5. Do not use generated code derived from another project's source.
6. Official documentation (Ubuntu, systemd, D-Bus, polkit, POSIX, web
   standards) may be used as technical references.
7. Implement from the product specifications in this repository.
8. Record the reference specification and original design rationale in each
   pull request.
9. Stop and report any accidental exposure to another project's source.

## System principles

1. The live Ubuntu system is the source of truth.
2. Do not maintain a duplicate desired-state database for the host.
3. Reflect changes made through SSH or other tools.
4. Run ordinary operations as the authenticated Linux user.
5. Use a small, typed privileged broker for elevated actions.
6. Never expose a generic root shell or arbitrary privileged command API.
7. Prefer stable machine APIs such as D-Bus over parsing human-readable CLI
   output.
8. Make risky operations transactional and reversible.
9. Every privileged mutation must be authenticated, authorized, validated,
   idempotent where possible and audited.
10. Keep idle server resource usage low.
