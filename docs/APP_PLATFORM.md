# Lumo App Platform

Calendar, Skills, Git, Docker, Nginx and Monitor are also independently built,
administrator-deployed [shipped app plugins](SHIPPED_APP_PLUGINS.md). They use
the trusted host SDK. The local apps described below use the isolated runtime.

Lumo supports local desktop apps that Pi can create, build, preview, install and
update without rebuilding Lumo. Apps run independently of the Pi conversation.
Apps use JavaScript or a fixed React/TypeScript SDK with CSS, optional read-only
CPU and memory access, and private saved data.

## Use it

Deploy the updated Lumo frontend and `lumod` together. Pi must already be
installed and configured. App builds use Pi's private Node.js runtime when installed, or system Node.js;
the build command never downloads it. Enable **Lumo Use** in Pi to open previews from the
chat, and use a permission mode that permits app changes. **Lumo App Builder** in
**Pi → Settings → Extensions** controls Pi's app tools and is enabled by default.
Disabling it removes those tools when each chat next becomes idle, preserving its
conversation and draft. Installed apps, App Library and saved app data remain
available independently of Pi.

Ask Pi:

> Create a Server Pulse desktop app in a new folder in my workspace. Discover
> the Lumo app API, build it, and open a preview. Install it after checking the
> result.

Pi discovers the contract through `lumo_app_api`, creates the local template,
edits source with its existing coding tools, and builds an immutable snapshot.
The current permission mode applies to these operations. Ask mode presents the
exact tool input for approval. Read-only mode permits API discovery, listing and
status checks, but blocks creation, builds, previews and installation.

Validated builds appear in **App Library → Discovery → Your desktop apps**.
Preview opens the selected build with declared access and separate temporary
app data. Install adds it to
the dock and app search. App Library also provides Open, Disable, Enable,
Uninstall and Restore previous version. **Updates** shows newer staged versions,
Update all when applicable, and completed version changes.

To revise an app, ask Pi to edit its project and increase its manifest version,
then build and preview the new version. Installation switches to the selected
snapshot. Source edits alone do not change the installed app. Normal uninstall
moves installed snapshots to recoverable Trash and preserves app data. Clean
uninstall also moves the app's data folder to Trash. Both preserve project files.

If an app prevents normal use, add `?recovery=1` to Lumo's URL. This skips
restoring installed-app windows; use App Library to disable, restore or remove
the app. Close other browser tabs that still have the app running.

## Package and SDK

A new project contains:

```text
server-pulse/
  lumo.app.json
  lumo.d.ts
  README.md
  src/main.js
  src/style.css
```

Example manifest:

```json
{
  "schemaVersion": 1,
  "id": "local.server-pulse",
  "name": "Server Pulse",
  "version": "0.1.0",
  "description": "CPU and memory usage for this server.",
  "license": "AGPL-3.0-only",
  "apiVersion": 1,
  "entry": "src/main.js",
  "styles": "src/style.css",
  "window": {
    "width": 720,
    "height": 480,
    "minWidth": 390,
    "minHeight": 320
  },
  "capabilities": [{ "name": "system.metrics.read" }]
}
```

App IDs use `local.` followed by a lowercase letter and up to 63 lowercase
letters, digits or hyphens. Versions contain three numeric components. A version
cannot be reused for different source. Entry paths are `src/main.js` or `src/main.tsx`, with `src/style.css`. Unknown manifest fields, unsupported capabilities and API versions,
invalid dimensions, oversized input and symlinked source entries are rejected.
A package can declare an empty capabilities array for UI-only apps.

The runtime creates `<main id="app">` and starts the source module after its
host connection is ready. The supported SDK is:

```js
const sample = await lumo.call('system.metrics.read');
// sample: { cpuPercent, memoryUsedBytes, memoryTotalBytes, at }
// at is a Unix timestamp in milliseconds.
lumo.ready();
```

The host sets `document.documentElement.dataset.theme` to `light` or `dark`, and
`dataset.motion` to `reduced` or `full`. Apps must honor these settings. The local
Server Pulse template demonstrates theme styling, metrics refresh and accessible
status text. `lumo.d.ts` supplies editor declarations. The React template adds single-file
TSX compilation and bundled SDK imports as described below. External packages,
remote assets and custom build configurations are unsupported. There is no app
package installation step.

Build reads bounded source through a project-root handle, uses a fixed Node.js
syntax-check command without executing the app, validates the manifest, and
computes a SHA-256 digest over the normalized manifest and source. Limits are
1 MiB JavaScript, 128 KiB CSS, 64 staged builds and 32 installed apps per account.
Runtime errors remain possible after a successful syntax check. Preview and
runtime diagnostics are separate checks.

## React and TypeScript

Choose `template: "react"` with `lumo_app_create` to generate a saved-message
app in `src/main.tsx`. It uses React 18.3.1 and TypeScript 5.7.3, pinned by the
Lumo build. The source can import `react`, `react-dom/client`,
`react/jsx-runtime`, and `@lumo/ui`. Shared controls are `Button`, `Field` (a
text input with a required label), `Panel` (title and children), and `Status`
(live status text). The template uses the same storage and dirty-state APIs as
plain JavaScript apps. `lumo.d.ts` contains a minimal authoring declaration set,
not the complete React type definitions.

The server compiles one bounded TSX source file using an embedded compiler and
bundles the fixed React runtime into the immutable app snapshot. Compilation
checks syntax, not full TypeScript types. The runtime still uses the same opaque
frame, policies and narrow capability bridge. Installed bundles keep their exact
runtime when the server is upgraded; rebuilding with a changed SDK requires a
new app version.

Only the listed static SDK imports are supported. Local module imports, dynamic
imports, direct `require`, project dependencies, `tsconfig.json`, source maps,
package scripts and custom build steps are not part of this contract. Builds do
not execute app source or install packages. Exported values and JSX are compiled
to a private module wrapper whose loader only supplies SDK modules.

For Lumo development, `npm run build` prepares the toolchain from existing locked
dependencies through `npm run build:app-sdk`. It uses esbuild 0.25.12 for the
fixed compiler/runtime bundles; version mismatches fail explicitly. The generated
files in `server/internal/desktopapps/toolchain/` are ignored by Git and embedded
in `lumod`. Prepare them before Go tests or a standalone Go build. Missing
bundles fail TSX builds clearly without downloading dependencies. Production
build scripts and Docker packaging include the generated toolchain.

This compiler uses the documented [TypeScript single-file compilation model](https://www.typescriptlang.org/tsconfig/#isolatedModules)
and [esbuild build API](https://esbuild.github.io/api/).

## Saved data

Declare `{"name":"app.storage"}` in the manifest to save one JSON document per
app and Linux account. App Library displays this access before installation.
The runtime selects the app identity from its launch; apps cannot choose another
app's identity or a filesystem path.

```js
const current = await lumo.call('app.storage.get');
const next = await lumo.call('app.storage.set', {
  revision: current.revision,
  value: { count: (current.value?.count ?? 0) + 1 }
});
```

Reads return `{revision, value}`, initially `{"revision":"","value":null}`.
Writes require the last read revision and return the newly saved snapshot. A
stale revision fails with `error.code === 'conflict'`; reload before retrying.
After a timeout, read again to determine whether the save completed. Never
blindly replay a change. Display success only after the save response.

Each value is limited to 64 KiB of serialized JSON in UTF-8. Unknown parameters,
invalid JSON and oversized values fail without changing the saved document.
Use `null` to clear the value. All capability calls share a limit of 30 requests
per ten seconds per launch; metrics retain an additional four-per-second limit.
Store changes are serialized with app activation changes and written atomically.
Saved data lives in `data/<app-id>/storage.json` beneath the account's app store.

Installed data survives reloads, agent restarts, updates, code rollback and
normal uninstall/reinstall. Clean uninstall moves it to recoverable Trash.
Previews start with empty, in-memory data for each launch, cannot read or change
installed data, and discard it when closed, expired or the agent restarts.
Installing a preview does not copy its temporary data.

Ask Pi to create a Counter using `lumo_app_create` with `template: "counter"`.
This local example saves only after a button press, disables controls during
saving, and requires a reload after a conflict or ambiguous failure. It does
not buffer unsaved edits. The Notes template demonstrates the unsaved-edit contract.

## Unsaved edits

`lumo.setDirty(true)` tells the shell that a window has unsaved edits. Call it
immediately when editable content differs from the saved version, then call
`lumo.setDirty(false)` only after a successful save or explicit discard. It is
window-local, takes a boolean, and requires no additional capability.

Close, Quit, Log out, and App Library changes respect this state. Cancel returns
to the editor; Discard changes continues the requested action. Group actions
wait for every affected window before closing any of them. App Library resumes
the original action after confirmation. Storage writes also hold the window
open while the response is pending. Saving successfully can complete a pending
close automatically.

When Pi or another tab updates, disables or removes an app, Lumo preserves a
dirty window instead of replacing its frame. The old launch loses capability
access immediately. A notice asks the user to copy unsaved work before reloading;
reload also requires confirmation. Clean windows adopt the current version.
There is no permission to save through a revoked launch.

Browser reload and navigation use the standard unsaved-work warning when the
browser permits it. This is not crash recovery, guaranteed mobile unload
protection, or a way to prevent session expiry. App code must report dirty state
correctly. Saving app data remains the durable persistence mechanism.

The `notes` template demonstrates this contract with an explicit Save button,
a bounded text editor and conflict handling that preserves the current draft.
Ask Pi to create a project with `template: "notes"` to start an editor.

## Architecture

| Module | Responsibility |
| --- | --- |
| `server/internal/desktopapps/` | Manifest, template, source checks, immutable bundles, activation, recovery and app document generation |
| `server/internal/httpapi/desktop_apps.go` | Authenticated launches, metrics and app-owned storage bridge |
| `server/cmd/lumod/desktop_apps.go` | Same-account JSON command adapter for Pi |
| `server/internal/httpapi/pi_apps.mjs` | Pi tool definitions and app workflow |
| `server/internal/desktopapps/sdk.js` | Embedded frame SDK, capability requests and dirty-state reporting |
| `src/platform/` | Dynamic catalog, App Library controls and isolated window contents |
| `src/api/desktop-apps.ts` | Typed live/mock contract |

The shell continues to own authentication, window controls, dock, search and
lifecycle. Existing built-in apps retain their trusted React renderer. Installed
apps appear through dynamic `app:local.*` identities and run inside an iframe
with only `allow-scripts`; they cannot access the parent document or its session
credentials. Multiple windows have separate launch authorizations.

The production gateway applies a route-specific content policy to app documents.
Scripts and styles use a per-document nonce; connections, child frames, workers,
forms and external resources are blocked by the document policy. The desktop's
own script policy remains unchanged. The parent checks the sending window and a
fresh handshake before transferring a dedicated message port. The app receives a
narrow `lumo.call` method, not a general HTTP proxy.

The server binds each launch to the authenticated session, exact digest and
installed activation revision, with a one-hour expiry. The trusted parent keeps
the capability token; the frame URL uses a separate load identifier. Requests
recheck activation and declared access, and both host and server enforce request
limits. Closing, navigation or a management action revokes the launch. Changes
made through Pi are detected by the catalog on focus or its 30-second refresh;
old installed launches fail authorization immediately on their next request.

These are boundaries for reviewed local apps, not complete hostile-code
containment. Frames do not provide reliable CPU limits or guaranteed separate
browser processes. Frame navigation remains a possible data-exposure channel;
it revokes the bridge but is not advertised as complete network confinement.
Pi's editing tools still have the authenticated Linux account's permissions.

## Storage and lifecycle

State lives under the authenticated account's home directory:

```text
~/.local/share/lumo/desktop-apps/
  builds/<digest>.json
  state.json
  <digest>.status.json
  data/<app-id>/
```

A store lock serializes management operations. Artifact and activation writes use
temporary files, synchronization and atomic replacement. State records the
current and previous digests, activation revision, recent history and operation
receipts. An expected revision rejects stale changes; a request ID can replay
the same operation for 24 hours and cannot be reused with different input.
An incomplete artifact publication never becomes the active version.

Catalog reads use saved metadata and check artifact presence. Launches check
full bundle integrity. Code rollback switches the snapshot; it does not undo
app data changes. Apps must keep stored data backward compatible. There is no
automatic data migration API.
Uninstall retains recoverable artifacts in Trash. These account-writable files
are not an isolation boundary against another process running as the same user.

## Pi tools and protocol

| Tool | Result |
| --- | --- |
| `lumo_app_api` | API version, capability and source rules |
| `lumo_app_create` | New project; `pulse` for metrics (default), `counter` for saved data, `notes` for an editor, or `react` for TSX |
| `lumo_app_build` | Checked snapshot and exact digest |
| `lumo_app_list` | Installed revisions and staged builds |
| `lumo_app_preview` | Open the exact build in the connected Lumo tab |
| `lumo_app_status` | Last bounded ready/error report for a digest |
| `lumo_app_install` | Install or update the exact digest |
| `lumo_app_restore` | Restore the previous installed snapshot |

The management adapter is `lumod desktop-app api|create|build|list|install|restore|status`,
with one JSON object on stdin and one JSON result on stdout. It runs as the real
account, never through the privileged broker. Preview uses the existing Lumo Use
request transport and is available only when that extension is enabled.
See [Protocol](PROTOCOL.md#desktop-app-packages) for the HTTP contract.

App status is self-reported diagnostic data. A ready report does not establish
visual quality, correct calculations or successful testing. Pi must keep that
distinction when reporting results.

## Boundaries and next steps

This release supports small metrics apps and utilities with app-owned saved data. It does not
provide arbitrary server plugins, filesystem access, background jobs, app-owned
menus, automatic draft recovery, arbitrary dependency bundling or a
marketplace. App Library closes affected app windows before a management change;
Pi/CLI activation changes reload clean windows when the catalog refreshes and
preserve dirty windows for recovery by the user.

Further extensions should add richer capabilities driven by real apps, then
multiple source modules and full type checking for larger app projects. Migration of further built-in apps should follow proven API boundaries. Core Lumo edits still require the
normal build, test and deployment process.

## Verification and design references

Run `npm run build`, `npm run test:unit`, and
`npm run test:ui -- tests/ui/desktop-apps.spec.ts` for focused checks. The browser
suite covers lifecycle, persistence, light/dark and narrow layouts, and actual
app documents behind the production gateway. The host gateway fixture uses a
local authentication stub; it does not establish live PAM or provider behavior.
Use `npm run test:docker` for the offline Ubuntu gate and `npm run test:all` for
all repository gates when cached dependencies are prepared. No model provider or
external package download is used by these checks. See [Testing](TESTING.md).

This design implements the Lumo [Product](PRODUCT.md), [Privilege Model](PRIVILEGE_MODEL.md),
[Protocol](PROTOCOL.md), [Design Principles](DESIGN_PRINCIPLES.md) and
[Desktop Style](DESKTOP_STYLE.md) contracts. A small trusted core, exact artifacts
and typed capabilities permit app iteration while retaining the existing
Ubuntu authorization model and a concrete rollback target.

An explicitly authorized architectural review examined DeepSeek Harness commit
`639ed015397290b3745d163aafe02ffee4aa3f84`. It motivated runtime API discovery and
agent-authored packages. No implementation was copied or translated. This
review does not amend Lumo's general clean-room rules.
