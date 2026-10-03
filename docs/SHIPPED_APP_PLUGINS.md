# App plugins

Calendar, Skills, Git, Docker, Nginx and Monitor are trusted Lumo app packages.
Each package owns its frontend, any app-specific backend, and any Pi extension.
One manifest selects their version together. Files, Preview, Terminal, Pi,
Settings, App Library and Trash are core apps.

## Ownership

| App | Frontend | App backend | Pi extension |
| --- | --- | --- | --- |
| Calendar | Views, editing, reminders | SQLite store, recurrence, Google integration, notices, CLI | List and change tools |
| Skills | Browser and details | Account skill discovery and reading | None required |
| Git | Repository, changes and history | Git operations, revisions and validation | None required |
| Docker | Containers and resources | Docker reads and typed action requests | None required |
| Nginx | Sites, editing and logs | Website reads and typed save requests | None required |
| Monitor | Metrics, processes, services and logs | Uses shared host capabilities | None required |

An optional component is omitted when the app does not need it. Monitor does
not need a duplicate metrics sampler or service manager. Pi remains Lumo's core
assistant engine. Its setup and updates are in Pi → Settings → Engine; App
Library has no Pi entry or uninstall control.

App source lives in `apps/<name>/`, including `lumo.plugin.json`, `src/`, and
optional `backend/` and `pi/` directories. The Go apps module builds each backend
separately. `plugin-sdk/` defines the versioned process protocol and shared API
response format. Calendar, Skills and Git implementations are not linked into
the production host binary. Calendar keeps its existing account database and
Google configuration paths. Git uses the account's existing repositories and
configuration; Skills reads existing skill folders.

Docker and Nginx also own their system-operation implementation and validation
source. Their privileged operations are compiled into the broker as reviewed,
typed capabilities. Updating unprivileged app code does not replace root code.
Changing a privileged capability or its authorization contract requires a host
release. This is a deliberate boundary: installed plugins cannot execute
arbitrary code as root.

The host owns authentication, sessions, the desktop, windows, shared controls,
notifications, system sampling and the privileged broker. Apps use the typed
host SDK. Frontend builds reject imports outside the app except React and
`@lumo/sdk/*`. React is shared with the host. Native packages are discovered from their manifests. New app identities,
frontend entries, backend routes and Pi tools do not require a host release.
The set of privileged host capabilities remains reviewed and compiled into Lumo.

## Backend lifecycle

The authenticated per-user agent dispatches app-owned HTTP routes to the
selected backend executable. Each request starts a short-lived process under
the same Linux account, with private standard-input/output transport. There is
no public backend port and no idle backend process. Requests have body limits,
response limits and a deadline. A crash produces an app error while core apps
remain available. Git operations are serialized. Mutations retain host request
replay protection, and reuse of a successful request ID with different content
is rejected.

Backend responses can request only the app's allowed typed broker actions. The
host supplies the original authenticated session; it does not send session
credentials to plugin processes. The broker still validates, authorizes and
audits each privileged operation.

The manifest selects hashed executable and Pi-extension assets. The host checks
platform, protocol, paths, namespaces and checksums before use. Pi loads tool
names and source from the app package when a chat starts. Read tools and write
tools remain subject to Lumo's permission mode. Removing an optional app package
does not prevent the Pi engine from starting. Installed account packages take
precedence over shared packages. Uninstalled account selections suppress the
shared app for that account; another account keeps its own selection.

These are trusted native packages, not a security sandbox. Pi can create them
through the complete-plugin builder described below. Pi also supports the
separate sandbox builder in `APP_PLATFORM.md`; those apps retain an isolated
iframe and declared host capabilities. Their installer does not accept native
backends. Neither builder can install arbitrary root capabilities.

## Build

With the locked Node dependencies, local Go toolchain and Go dependency cache
prepared, run from the repository root:

```sh
npm run build:plugins -- calendar
npm run build:packages -- -app calendar
```

The first command builds the frontend. The second produces the complete package
in `.tools/plugin-packages/calendar/`, including a backend for the build
machine's platform and the optional Pi extension. It does not download tools or
dependencies. A package for Ubuntu must be built on Linux with the target
architecture. `docker/Dockerfile.ubuntu24` does this with the cached build image.

`npm run build` checks TypeScript and builds the host and all frontend packages.
`npm run build:packages` builds all complete packages. `scripts/build-with-web.sh`
builds both and places `lumod` with a sibling `plugins/` directory in `server/bin`.
The installer accepts this complete distribution and validates every package
before activating the host and plugin files transactionally.

Frontend assets also appear in `public/plugins/` for local Vite development.
Executable and Pi assets are kept out of public web output. The gateway serves
only approved frontend assets and manifests, never backend executables or Pi
extension files.

## Deploy and recover

The default bundled directory is `/usr/local/lib/lumo/plugins`. A distribution
can instead have a `plugins/` directory beside `lumod`. Administrator overrides
live in `/usr/local/lib/lumo/plugin-overrides`. `LUMO_PLUGIN_BUNDLED_DIR` and `LUMO_PLUGIN_DIR`
can change these paths; configure the same values for the gateway and sessiond.
The legacy gateway `-plugins` option changes only its web directory and must
match the agent's override directory. Keep native package directories owned by
the administrator and readable by the gateway and authenticated users.

On the machine holding the complete package for the target platform:

```sh
npm run deploy:plugin -- calendar /usr/local/lib/lumo/plugin-overrides
npm run deploy:plugin -- calendar /usr/local/lib/lumo/plugin-overrides --rollback
npm run deploy:plugin -- calendar /usr/local/lib/lumo/plugin-overrides --bundled
```

Deployment validates every component before atomically replacing `manifest.json`.
The preceding manifest is retained for rollback. Old hashed files stay available
for open windows and in-flight requests. Backend requests use the selected
package immediately. Reopen the app window for frontend changes, reload the
desktop for frontend background services, and start a new Pi chat for extension
changes. Existing windows, drafts and chats are not forcibly closed.

Rollback switches the whole package, not just its frontend. It does not reverse
data changes. Plugin versions must retain compatible storage formats and host
API contracts; incompatible migrations require a separate recovery design.

## App Library

All Apps groups the six shipped apps under Lumo Apps and locally created apps
under Custom Apps. Empty groups are hidden. Both groups use the same cards and
detail navigation. Git, Docker and Nginx's Install/Uninstall controls manage the
underlying Ubuntu software. They do not remove the app plugin or deploy native
code. Calendar, Skills and Monitor are included with Lumo. App package updates use either the per-account flow below or the administrator
deployment flow above. Custom apps retain their existing
per-account install, update, rollback and uninstall flow.

## Install a complete app for one account

`npm run build:packages` also writes `.tools/plugin-packages/<name>.lumoplugin`.
This is a JSON bundle containing `name`, the complete `manifest`, and a `files`
map of hashed filenames to base64 bytes. There are no install scripts. App Library
checks the entire bundle before adding it to the account's available versions.
Import does not run the app or register its Pi tools. Each version identifies
one package; changed contents require a new version number.

In App Library, choose **Import app**, select the package, read its App access,
and choose **Install**. The app appears in the dock. Its backend and Pi extension
use the same selected package version. Imported updates appear in Updates and
in the app's details. Close its windows before changing the package; finish any
running Pi work before changing an app that contributes tools. A new Pi chat
loads the current extensions. Existing running Pi processes keep their loaded
code until they exit.

Native plugins execute trusted code with access to the signed-in account's
files, network and desktop session. They are not isolated from other account
apps. Installing or updating explicitly grants this account access. Declared
`broker.*` permissions select only existing typed host operations; every such
operation still passes through session authentication, authorization and audit.
A manifest cannot add a root command or bypass broker checks. New privileged
operations still require a Lumo release.

Packages and selections live under `~/.local/share/lumo/native-plugins/` with
private account permissions. Versions are immutable and selected by an atomic
file replacement. Update retains the prior version for **Restore previous
version**. A stale selection cannot overwrite another change. Normal Uninstall
removes the app from the account and keeps its data and cached packages for
reinstallation. Clean uninstall moves the app's `LUMO_APP_DATA` directory into
recoverable Trash. Repositories, website files, Ubuntu packages and legacy or
shared settings are preserved. Existing Calendar databases keep their original
location and are preserved by app-package removal.

## Add a new native app

Create `apps/notes/lumo.plugin.json`, `apps/notes/src/index.ts`, and optional
`backend/` and `pi/` folders. The frontend build discovers app directories; no
core registry edit is needed. A new package name uses lowercase letters, digits
and hyphens, begins with a letter, and has at most 48 characters. Core app names
are reserved. Its manifest ID is `plugin:notes`. Existing shipped IDs remain
compatible.

The manifest uses schema and host API version 1, a semantic version such as
`1.0.0`, AGPL-3.0-only, `name`, optional `description`, an icon from the host icon
set, and window dimensions. `permissions` includes `account` and any supported
`broker.*` operations. The packager fills in the hashed frontend, backend and
extension entries. Backend routes use the app namespace, for example
`GET /api/v1/plugins/notes` and `POST /api/v1/plugins/notes`. Reserved legacy
routes continue to serve the six shipped apps. Backends use process protocol 1
and declare the target operating system and architecture.

Frontend code imports React and supported `@lumo/sdk/*` modules. For an app's
backend, import `requestPlugin` from `@lumo/sdk/api/plugins`; call
`requestPlugin('notes')` to read or `requestPlugin('notes', {text: 'Hello'})` to
change data. The data-source layer supplies authentication, CSRF protection and
request IDs. Backends receive `LUMO_APP_DATA` for their own data directory and
must create it if needed. The SDK process protocol is described in
`plugin-sdk/README.md`. `lumod plugin notes <command>` dispatches to the selected
account backend for CLI and Pi use.

An optional Pi extension declares its setting name and tool names. Notes tools
use the `lumo_notes_` prefix; hyphens in package names become underscores. Its
read and write tool lists join Lumo's normal Pi permission handling. An extension
must follow that declared contract; native code is trusted, not sandboxed.
Authentication callbacks are namespace-scoped and use temporary, HttpOnly,
SameSite=Lax return cookies. Frontend assets require the account's session;
backend and Pi source files cannot be downloaded through the web asset route.

A package for Ubuntu must contain a Linux backend for the server architecture.
Validation rejects mismatched platforms, unknown permissions, path escapes,
invalid checksums and core or cross-app route collisions before activation.

## Verification

```sh
npm run build
npm run test:unit
npx playwright test tests/ui/plugins.spec.ts tests/ui/app-library.spec.ts tests/ui/pi.spec.ts
npm run test:docker
```

Offline checks cover app backend logic, host HTTP contracts, request replay,
manifest replacement without a host restart, crash containment, denied broker
capabilities, corrupt assets, package deployment and rollback, Calendar tool
permissions, Pi setup and updates, and browser workflows. The Docker build also
runs the Linux Go suites and builds all native packages for its architecture.

The design follows Lumo's App Platform, Protocol, Privilege Model and Desktop
Style specifications. The process protocol uses standard HTTP request framing
and a bounded JSON response over private pipes. No third-party implementation
was used as a reference.


## Building complete plugins in Pi

Enable Lumo App Builder in Pi settings. Start with `lumo_plugin_api`, which returns
an embedded [authoring guide](../server/internal/appbuilder/GUIDE.md) covering the
UI, backend and Pi extension. `lumo_plugin_create` creates all three parts by
default, with backend/Pi parts optional. It adds a `validate.mjs` script that calls
the installed host validator. The host repeats validation in `lumo_plugin_build`
and `lumo_plugin_install`; changing the project's script cannot skip those checks.

The current authoring toolchain compiles local React/TSX modules using Lumo's
fixed host imports, a self-contained Node.js backend, and a self-contained Pi
extension. Builds are offline and do not execute app code or project scripts.
Diagnostics include file, code, message, fix and source location where available.
Checks cover source boundaries, imports, syntax, manifest compatibility, namespaced
routes, and exact Pi tool declarations. They are not full TypeScript type checking
or proof of runtime behavior. Test actual UI flows and backend/Pi operations.

`lumo_plugin_build` stages an immutable account package; it does not activate it.
`lumo_plugin_list` supplies revisions, `lumo_plugin_install` selects an exact digest
with explicit account trust, and `lumo_plugin_restore` restores previous code.
These tools share App Library's account catalog and filesystem lock. Management
request IDs retain the last 64 successful receipts per app, atomically with the
selection, and reject changed payloads. Stale revisions still fail after receipts
expire from that bounded history. Existing app data survives code changes.

Backend manifests may set `runtime: "node"`. Lumo then uses the account's installed
Pi Node runtime or system Node without downloading anything. Omit runtime for
existing native executables. Native plugins remain trusted account code. Existing
running Pi processes must restart to load changed extension code. Native builder
previews are not isolated: validate first, then install within the user's scope
and test the installed app. Sandbox builder previews remain separate.
