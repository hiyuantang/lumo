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
`@lumo/sdk/*`. React is shared with the host. The supported app identities and
host capabilities remain registered by a host release; this is not an
unrestricted native plugin marketplace.

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
does not prevent the Pi engine from starting.

These are administrator-trusted native packages, not a security sandbox. Custom
apps made by Pi retain the isolated iframe runtime and declared host capabilities
described in `APP_PLATFORM.md`. They cannot install arbitrary native backends or
root code through the custom-app installer.

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
code. Calendar, Skills and Monitor are included with Lumo. App package updates
use the administrator deployment flow above. Custom apps retain their existing
per-account install, update, rollback and uninstall flow.

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
