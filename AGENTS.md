# Lumo — Agent Guide

## Complete, commit and push

- Treat one coherent feature, bug fix, refactor, or documentation update as a
  unit of work. Include the implementation, relevant tests and documentation
  needed to make that unit usable and reviewable. For larger requests, use
  independently usable milestones; do not commit unfinished fragments.
- After completing a unit, review its diff, run the required checks appropriate
  to the change, fix failures caused by the change, then commit and push it to
  `origin/main` before reporting completion. This is standing authorization;
  do not ask again for routine commits or pushes.
- Stage only files or hunks belonging to that unit. Preserve unrelated local
  edits and do not publish unrelated unpushed commits. Report existing failures
  or unavailable checks accurately; never claim that a failed check passed or
  bypass a required check to publish.
- Fetch the latest `origin/main` before publishing and integrate remote changes
  without losing local work. Use a normal push, never a force push. If a conflict,
  branch protection or another blocker prevents safe publication, preserve the
  work and explain the blocker instead of reporting it as pushed.
- Report the commit, push result and verification performed. An explicit user
  request for read-only work, no commit, no push, or another target takes
  precedence over this workflow.

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

## App and engine architecture

Lumo is a plugin-based app platform. Keep apps self-contained and the engine
reusable. This applies to shipped apps, required system apps and user-built apps.
A required app may be protected from removal without moving its features into
the engine. Pi is a required app and hosts the agent and app-building extensions.

- Keep each app's frontend, backend, Pi extension, styles, icon and manifest in
  its own package. Use only the parts that app needs. Share domain operations
  between its UI and Pi tools instead of duplicating business rules.
- The manifest declares identity, entry points, permissions, window behavior
  and assets. Discover packages through the catalog; do not add an app ID branch
  to the shell to install, launch or render a new app.
- The engine owns sessions, account isolation, package lifecycle, window layout,
  menus, command search, dock, notifications, shared UI primitives and typed
  system services. Apps contribute content and actions through the host SDK;
  the engine controls their presentation, routing, validation and cleanup.
- Use `@lumo/sdk/app` for native app menus, window title/status, window state,
  preferences, close guards, file picking and shared dialogs. Register actions
  with `useAppMenus`; do not edit MenuBar, Dock or CommandCenter for app features.
  Declare `window.multiple` for multiple windows. Scope drafts and commands to
  their window; release registrations when the window closes or code unloads.
- Sandboxed apps use the validated message bridge for menus and window status,
  and declared capabilities for data. Never use parent DOM access or expand
  their permissions merely to integrate with the desktop. Native plugins are
  trusted account code; manifest permissions do not make them sandboxed.
- Use typed APIs for files, notifications and system operations. Keep privileged
  actions in the authenticated, authorized and audited engine broker. Never
  supply arbitrary root execution through a plugin.
- A frontend `background` component belongs to its app and must clean up effects
  on update, uninstall and logout. It runs only while the desktop is connected.
  Persistent server work needs an explicit account service; notifications do
  not schedule jobs or keep request backends alive.
- When an app needs a missing integration, add a small reusable host contract,
  document it in the builder guide, expose it through validation and test its
  lifecycle and account/window boundaries. Do not introduce another special
  case for one app. Keep compatibility adapters explicit until migrated.
- Treat validation, import, install, update, rollback and uninstall as one
  contract. Keep source examples, SDK exports, compiler allowlists, manifest
  validation and tests consistent. Preserve user data and unsaved work.

See [APP_CONNECTIONS.md](docs/APP_CONNECTIONS.md) for supported connection points,
examples, lifecycle limits and remaining compatibility adapters.

## Coding conventions

- Do not add license headers other than the SPDX line above.
- Do not add inline comments unless explicitly requested.
- Match the style of neighboring files; do not introduce new frameworks
  without checking the project first.

## UI design rules

Apply these rules to every UI change. See [DESKTOP_STYLE.md](docs/DESKTOP_STYLE.md)
for visual details and [DESIGN_PRINCIPLES.md](docs/DESIGN_PRINCIPLES.md) for
interaction and accessibility requirements.

- **Organize compact areas deliberately.** Place each piece of information where
  it supports the relevant action. Avoid repeated labels, values, and explanations.
- **Reuse components for design consistency.** Reuse existing shared components,
  styles and interaction patterns before creating new ones. Extend a shared
  component when the same design is needed in another place; avoid duplicating
  controls or styling for equivalent UI.
- **Use space efficiently.** Keep actions beside the heading or content they
  affect. A single Edit or Refresh button must not consume a whole row.
  Avoid duplicate information, redundant controls and unnecessary metadata.
- **Keep navigation compact.** Put Back and Forward on the left, followed by
  the current page or folder name. Move lengthy details to a separate page.
  Use distinct icons for navigation, sidebar toggling and other actions.
- **Scope controls locally.** Search belongs above the list it filters. Put
  compact icon-only Refresh controls with tooltips in the left panel or card
  header; App Library uses View → Refresh. Do not add unexplained refresh icons
  or extra update buttons.
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
- **Put selection controls on the right.** Place checkmarks, checkboxes and other
  selection indicators to the right of their labels, across menus, dropdowns,
  settings and lists. Keep labels left-aligned and controls right-aligned in a
  consistent trailing column; never place selection marks before the labels.
- **Make menus consistent.** Left-align labels with a fixed checkmark column on
  the right.
  A checkmark alone shows the selected choice; never add a persistent selected
  background. Reserve the row highlight for the single hovered or keyboard-active
  item, so adjacent options never appear joined. Use the shared menu input
  handling: pointer movement activates hover, keyboard navigation activates
  keyboard focus, and only that input mode may paint a row background.
  Clicking outside a menu, including inside another app, dismisses it and
  performs the clicked action.
- **Use direct update flows.** App Library has All Apps and Updates. Offer
  Update per app and Update all. Completed updates move to installed history,
  showing old version → new version without an extra disclosure step.
- **Keep installation direct.** Install starts from one button, which becomes
  compact progress in the same place, then Uninstall on completion. Avoid extra
  review screens, success cards and ellipses on these action labels. Preserve
  server-required authentication and uninstall choices.
- **Keep uninstall choices explicit.** Offer normal Uninstall (default, keeps
  settings and data) and Clean uninstall (moves app settings, caches and stored
  data to recoverable Trash). Preserve project and website files.
- **Use consistent names.** Match names across the dock, menus and App Library
  (for example, Docker and Nginx). Omit incidental engine/demo labels from
  everyday controls; show version details where they help with updates.
- **Keep surfaces neutral and matte.** Light mode uses white and grey; dark
  mode uses near-black and charcoal. Buttons have a soft matte finish without
  glossy gradients, bevels or plastic highlights. App icons are colorful,
  minimalist and original. The desktop menu bar is transparent with no bottom
  separator.
- **Keep scrollbars at the panel edge, clear of content.** Extend the scroll
  area to its panel or dialog edge and inset the content inside it. Leave at
  least 8px between scrollbar
  tracks and fields, controls or row highlights. Reserve a stable gutter in
  scrollable forms and compact lists, with an allowance for overlay scrollbar
  tracks, so scrollbars never cover trailing controls.
  Preserve larger existing padding and aligned table or calendar columns.
- **Inset content dividers.** Leave space at both ends of separators between
  content rows, aligned with the card's inner padding (normally 16px). Preserve
  existing inset lines. Keep structural window, toolbar and sidebar borders
  distinct from content dividers.
- **Keep space between every clickable item.** Visible separation is essential,
  including in compact layouts. Use explicit margins or gaps between adjacent
  buttons, icon actions, links and clickable rows. Their hit areas and hover,
  focus or selection backgrounds must not touch or overlap. Preserve usable
  target sizes; never remove this spacing to fit more controls. Verify spacing
  at normal and narrow sizes, including touch layouts.
- **Give rounded row highlights breathing room.** Use small outer margins around
  hover and selection backgrounds so they do not touch headers, panel edges or
  neighboring highlighted rows. Files lists use 3px vertically and 8px
  horizontally, preserving the alignment of row text with column headings.
- **Keep checkbox activation precise.** Toggle checkboxes only when the checkbox
  itself is clicked or activated with the keyboard. Clicking surrounding text,
  a row, or empty space must not toggle them. Use accessible names on the input
  without wrapping the whole row in an activating label.
- **Share input styling.** Search boxes use `app-search`; ordinary text fields
  use `input`. Keep font size, line height, caret spacing and field height
  consistent, with flat borders. Focused fields use a subtle change to the
  existing border, without a thick outline or focus shadow. Preserve keyboard
  focus indicators on buttons, checkboxes and other controls.
- **Keep window controls small and clear.** Circular coral, amber and green
  controls belong at the top left, with readable, sufficiently bold glyphs.
- **Keep floating windows reachable.** They may extend left, right or below
  the desktop, but never above the menu bar; retain a draggable title-bar area.
  Overview offers a top-right close control on hover or keyboard focus and
  preserves unsaved-change prompts.
- **Align and animate disclosures.** Use the shared Disclosure control for expandable
  content. Center an SVG chevron in a fixed, nonshrinking icon column beside the
  label; never use text glyphs as arrows. Rotate the chevron and animate content
  height together on both expansion and collapse. Honor reduced motion and keep
  collapsed content out of keyboard navigation. Avoid empty action rows around
  collapsed thinking and tool entries.
- **Coordinate motion.** Transitions should feel smooth and explain state.
  A dock thumbnail disappears as its window restores, without lingering as
  a duplicate. Preserve window state and respect reduced motion. Verify UI
  changes in both themes and at normal and narrow window sizes as applicable.
- **Make gestures directly manipulate content.** During swipes, drags and
  pinches, content must follow finger movement continuously, including changes
  of direction. Show adjacent content as it enters the viewport. Decide whether
  to commit or cancel when gesture input ends, then settle naturally using
  distance and momentum; short or reversed gestures must return smoothly.
  Do not turn a gesture into a button-like threshold signal followed by a
  preset animation. Preserve native scrolling and gesture boundaries. Reduced
  motion may shorten settling animations, but must retain direct tracking.
  Preserve native momentum during continuous scrolling. Calendar Month view
  fits whole week rows to the window and settles to the nearest row after input
  ends, rather than a whole month. Keep weekday headings fixed; the month
  occupying the most visible cell area determines the title and highlighting.
  Apply the same grid rule to Week and Day: scroll continuously through days,
  snap horizontally to one day column and vertically to one hour row. Size
  columns and hour rows to fit whole cells in the available window; resize
  without losing the visible date and time. Keep date headings, all-day events
  and the time-label gutter fixed while their grid scrolls. Never replace
  column scrolling with a whole-week page jump. Year grids mark Today only
  in its own month. Date hover targets stay equally wide and tall, with circular
  highlights. Put month arrows beside the sidebar mini calendar; do not
  duplicate them in the main toolbar.
  Verify intermediate movement, reversal, cancellation and settling, rather
  than checking only the final destination.

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
- `npm run test:docker` — offline Ubuntu operations and browser workflows using
  local package fixtures and cached dependency images. Missing dependencies fail
  instead of downloading; `npm run test:docker:prepare` is explicit setup.
- `npm run test:online` — real external installer/package checks. Run only when
  absolutely necessary to verify upstream behavior, never for routine edits.
  Default tests must not contact external services or download apps.
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
- `apps/<name>/` — all shipped app packages, including required system apps.
  Keep app UI, app-specific backend and Pi extensions inside their package.
  Shared engine services stay in `src/platform/` and `server/internal/`.
- `src/apps/` — shared app controls and manifest-based registry.
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

## Writing tests

- Write new tests to run offline by default. Use mocks, fake command runners,
  local package fixtures and cached dependencies; never repeatedly download,
  install or uninstall real third-party apps during routine development.
- Browser tests must import `test` and `expect` from `tests/offline.ts` (using
  the appropriate relative path), which blocks unexpected external requests.
- Missing dependencies must fail clearly, without triggering automatic downloads.
  Dependency preparation is an explicit, separate step.
- Add a real online check only when local fixtures cannot verify the necessary
  upstream behavior. Tag it `@online`, keep it out of default suites and
  `test:all`, and run it only when absolutely necessary.

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
