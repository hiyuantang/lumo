# Lumo App Platform

Lumo supports local desktop apps that Pi can create, build, preview, install and
update without rebuilding Lumo. Apps run independently of the Pi conversation.
The first implementation supports self-contained JavaScript and CSS, with an
optional read-only CPU and memory capability.

## Use it

Deploy the updated Lumo frontend and `lumod` together. Pi must already be
installed and configured. App builds require Node.js on the server; the build
command never downloads it. Enable **Lumo Use** in Pi to open previews from the
chat, and use a permission mode that permits app changes.

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
Preview opens the selected build with temporary read access. Install adds it to
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
cannot be reused for different source. The only accepted entry paths are those
shown above. Unknown manifest fields, unsupported capabilities and API versions,
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
status text. `lumo.d.ts` supplies editor declarations; this build does not compile
TypeScript or React. External imports, package scripts, remote assets and custom
build configurations are unsupported. There is no package installation step.

Build reads bounded source through a project-root handle, uses a fixed Node.js
syntax-check command without executing the app, validates the manifest, and
computes a SHA-256 digest over the normalized manifest and source. Limits are
1 MiB JavaScript, 128 KiB CSS, 64 staged builds and 32 installed apps per account.
Runtime errors remain possible after a successful syntax check. Preview and
runtime diagnostics are separate checks.

## Architecture

| Module | Responsibility |
| --- | --- |
| `server/internal/desktopapps/` | Manifest, template, source checks, immutable bundles, activation, recovery and app document generation |
| `server/internal/httpapi/desktop_apps.go` | Authenticated launches and the narrow metrics bridge |
| `server/cmd/lumod/desktop_apps.go` | Same-account JSON command adapter for Pi |
| `server/internal/httpapi/pi_apps.mjs` | Pi tool definitions and app workflow |
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
app data changes. The initial SDK has no persistence or data migration API.
Uninstall retains recoverable artifacts in Trash. These account-writable files
are not an isolation boundary against another process running as the same user.

## Pi tools and protocol

| Tool | Result |
| --- | --- |
| `lumo_app_api` | API version, capability and source rules |
| `lumo_app_create` | New project from the local Server Pulse template |
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

This release supports small read-only apps and UI-only utilities. It does not
provide arbitrary server plugins, filesystem access, background jobs, app-owned
menus, persistent data, an unsaved-document contract, React bundling or a
marketplace. App Library closes affected app windows before a management change;
Pi/CLI activation changes reload those windows when the catalog refreshes. Apps
with unsaved editing state need a future lifecycle contract before deployment.

The next useful extension is a pinned React/TypeScript SDK and shared controls,
followed by one additional typed capability driven by a real app. Built-in app
migration should follow proven API boundaries. Core Lumo edits still require the
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
