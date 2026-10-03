# Development and testing

Lumo separates interface checks from real Ubuntu operations. Simulated data
keeps visual checks predictable; only tests against Ubuntu establish that
an operation actually changes the server.

## Test commands

Run commands from the repository root after explicitly preparing dependencies:
`npm ci`, `npx playwright install chromium`, and the project Go toolchain/module
cache. Setup may need internet access; ordinary test commands never provision
missing dependencies automatically. Go tests disable module and toolchain downloads.

Default tests are offline. Local HTTP/WebSocket test servers are allowed;
external browser requests are blocked and fail the test. Online checks are
reserved for cases that actually require verifying a third-party service or
installer, such as a changed upstream installation contract. Do not run them
for routine UI, uninstall, or regression changes.

| Command | Responsibility |
| --- | --- |
| `npm run build` | Typecheck the app and tests; build the live frontend |
| `npm run test:ui` (or `npm test`) | Browser appearance, layout, keyboard interaction, dialogs, drafts and error presentation using simulated data |
| `npm run test:ui:production` | Build the shipped frontend and check native Pi chat, sessions and setup |
| `npm run test:unit` | Go logic and edge cases, plus Python installer and uninstaller checks |
| `npm run test:docker` | Offline Ubuntu operations, Linux/PAM tests and browser workflows using locally generated package fixtures |
| `npm run test:docker:prepare` | Explicit network-enabled setup of cached build/runtime dependencies; not a test |
| `npm run test:online` | Explicit network-enabled integration checks, including real Nginx packages; run only when necessary |
| `npm run test:all` | Run all four gates in order; stop on a failure |

The local Go commands expect `.tools/go/bin/go`, with module, build and
workspace caches under `.tools/`. See [server development](../server/README.md)
for backend details. The Docker build uses its own Go toolchain, but the
WebSocket checker is built with the local toolchain.

## Interface tests

`tests/ui/` owns appearance and interaction. Existing checks cover window
geometry, dock clearance, compact layouts, menus, keyboard controls,
confirmation dialogs and preserving drafts. Files named `*-states.spec.ts`
simulate responses to render loading, success, conflict, permission and
connection states. They do not prove real authentication, authorization,
package installation or disk writes.

The Pi checks replay documented RPC events and responses without contacting a
model. Run `npm run test:ui:production` to check the production build. Syntax minification is disabled in
`vite.config.ts` because it causes a runtime error in the terminal's mode-query
handler; identifier and whitespace minification remain enabled. The Docker
suite also sends these queries through a real Ubuntu terminal.

`visual.spec.ts` compares login and Files screenshots at 1440×900 and
800×650. It fixes the displayed date, hides changing load indicators during capture and
disables animations during capture. Baselines live beside the test. Review
the actual images before accepting a deliberate appearance change:

```sh
npm run test:ui -- visual.spec.ts --update-snapshots
npm run test:ui -- visual.spec.ts
```

Use the same OS and Chromium version as the reference images; the initial
baselines are from macOS. Other platforms need separately reviewed baselines.
Do not update snapshots just to silence an unexpected difference. See
[Playwright visual comparisons](https://playwright.dev/docs/test-snapshots).

Both UI preview servers are started by Playwright on ports 5199 and 5200.
A port already in use causes a failure rather than silently testing another
server. Failure screenshots and traces are saved in `test-results/`.

## Real Ubuntu Docker tests

Start Docker Desktop (macOS) or a Docker engine that supports privileged
systemd containers, then run:

```sh
npm run test:docker
```

The runner requires the local `lumo-test-build:deps` and
`lumo-test-runtime:deps` images. If either is missing it stops without pulling;
prepare them explicitly with `npm run test:docker:prepare` when appropriate.
Source/dependency changes may require deliberately refreshing those images.

The frontend is built from installed local dependencies. The runner builds
`docker/Dockerfile.ubuntu24` with networking and image pulls disabled, including
the production frontend and PAM-enabled backend. It starts systemd, D-Bus, the gateway,
session service and privileged broker inside a fresh Ubuntu 24.04 container.
The image build also runs the Go tests on Linux with PAM enabled. Go module
and automatic toolchain downloads are disabled.

The Ubuntu test container uses an internal Docker network with no internet
route. A restricted local TCP relay exposes only its gateway to the host browser.
APT sources point exclusively to a generated `file:` repository. Its `nginx`
package is an original, minimal test fixture, not the Nginx web server. Real APT
and dpkg still install/remove the fixture, so file preservation, protected Trash,
authorization and recovery are exercised without external package downloads.
Pi uninstall uses a local executable fixture; its install/update commands
are covered by fake command runners and simulated browser responses. Pi installation and model calls are never executed by automated tests.

`scripts/integration-test.sh` checks real login, CSRF protection, filesystem
permissions, stale revisions, trash, service actions, policy denials, audit
records, package-plan progress, protected-file repair and rollback backups.
The WebSocket checks cover metrics, journal events, service changes made
outside Lumo, and a terminal running as the authenticated Linux user.

`tests/docker/` then opens the embedded live app in Chromium, without
intercepting API or WebSocket responses. It verifies login and logout,
saving and deleting a real file, preserving an external edit on conflict,
stopping a real service and displaying external service changes. Independent
checks inside the container confirm the actual file contents and service
state. API tests also verify that rejected writes leave the server unchanged.

Each run gets a unique container and an automatically assigned localhost
port. Set `PORT=18080 npm run test:docker` to choose a port. The runner
removes its containers and temporary network on exit, retains cached images, removes the login
cookie file and prints the temporary directory containing build logs,
container diagnostics and browser failure artifacts. Traces can contain
test credentials; use these fixture accounts only in disposable environments.

The container uses privileged mode and a writable cgroup mount so systemd
can run. Use a development machine or dedicated disposable runner. No
project files, personal directories or Docker socket are mounted into the
test container. The HTTP port binds only to `127.0.0.1`. Test-only credentials
and authorization rules must never be used for an installed server.

## Checks that still need a VM or VPS

Docker coverage does not establish reboot, shutdown, kernel, full Netplan
connectivity or firewall recovery behavior. Test those on disposable Ubuntu
VMs with console access and snapshots. Release validation should cover both
Ubuntu 24.04 and 26.04 and both supported CPU architectures.

Real Docker Engine and Nginx serving behavior need dedicated system integration
coverage; the offline package fixture does not prove upstream package or web
server behavior. `npm run test:online` explicitly enables external connectivity
and real Nginx installation checks, with no test retries. It is excluded
from `test:all` and must not be used unless external verification is necessary.

The separate `docker/Dockerfile.install-test` and installation checks are
documented in [the installation guide](INSTALL.md#transport-and-verification). Public
certificate issuance and externally reachable firewall ports require a
deployment check. They are not part of `npm run test:docker`.

## Local development

```sh
npm ci
npm run dev
```

This opens the interface with simulated data; any nonempty credentials work.
It does not administer a real server. Use `npm run dev:live` to proxy API and
WebSocket requests to a running Lumo gateway at `127.0.0.1:8080`.

`scripts/build-with-web.sh` embeds the frontend into a local binary. For a
real Ubuntu installation with Linux login support, use the
[source installer](INSTALL.md). Product and protocol specifications are in
[PRODUCT.md](PRODUCT.md) and [PROTOCOL.md](PROTOCOL.md). Follow the independent
implementation rules in [AGENTS.md](../AGENTS.md).

### Docker resource management

`npx playwright test tests/ui/docker.spec.ts tests/ui/server-apps.spec.ts`
checks resource sizes and references, protected resources, named confirmation,
volume/network creation and removal, image removal, compact screens, and the
App Library update and completion flow using simulated responses.

The `containers`, `httpapi`, `broker`, and `updates` Go packages test Engine
response normalization, network inspection, stale revisions, in-use guards,
fixed creation parameters, authorization, audit, replay, and installed-package
family selection. These tests do not update the host Engine or delete host data.

For an optional read-only contract check against a real local Engine, set
`LUMO_TEST_DOCKER_SOCKET` to its Unix socket and run the `containers` package with
`-run TestLiveDockerResourceInventory -v` using the project Go toolchain/cache
configuration. This test only invokes Engine GET endpoints. Live deletion,
volume/network creation, and real APT Engine upgrades require a disposable Ubuntu
host; successful mock tests do not establish those real mutation workflows.


Pi RPC transport tests launch the Go test binary as a local protocol fixture.
They verify JSONL framing (including Unicode separators), response correlation,
project isolation, event cursors, process shutdown, and rejected commands.
Browser fixtures cover streamed chat, tools, model/thinking changes, saved
sessions, queue cancellation, folder drop, and install/update progress. Provider
settings tests use a local SDK fixture and simulated browser responses for API
keys, browser links, device codes, prompts, disconnect, cancellation, stale
responses and credential redaction. No real provider login or request runs. Actual
Pi/provider interoperability still requires an explicitly authorized manual
check; automated tests never download Pi or invoke model providers.


### Git

`npm run test:ui -- tests/ui/git.spec.ts tests/ui/app-library.spec.ts` checks
individual and filtered select-all staging, mixed checkbox states, commit drafts,
history, branch search/create/switch/merge, dynamic Fetch/Pull/Push states, remote
selection, remembered clone destinations, clone/create/add repository flows, nested folder selection, focus
restoration and continued access to other apps while a dialog is open.
It also checks App Library updates and light/dark layouts at desktop and
390px widths, with external browser networking blocked.

`npm run test:unit` includes disposable real Git repositories and local bare
remotes: first commits, partial staging, literal filenames, renames, binary
previews, stale revisions, detached HEAD, conflicts, branch changes,
fetch/push, fast-forward pull, differently named tracking branches,
divergence rejection, clone/create operations and existing-destination
protection. HTTP tests cover route serialization and idempotent commit and
repository-creation replay. Package-plan tests include
Git's fixed APT target. These checks do not contact a hosting service or
install Git packages. They require Git already available in the test runtime.

Shared app-contained dialogs and pickers are also exercised by
`tests/ui/settings-folders.spec.ts`, `tests/ui/updates.spec.ts` and
`tests/ui/preview.spec.ts`.

Pi compaction settings are covered by `tests/ui/pi-compaction.spec.ts` and
`TestPiCompaction*` in the HTTP API package. Offline browser fixtures check
shared percentage and token budgets, model capacity previews,
validation, conflict recovery, draft protection, persistence, both themes and
narrow layouts. Go tests verify native settings JSON, independent fallback,
preservation of unrelated settings and model choices, stale revisions,
idempotent retry, malformed values, linked files and account-only permissions.
These tests do not invoke an LLM or spend tokens on compaction.

Pi conversation reference checks use `tests/ui/pi-references.spec.ts` for actual
HTML drag/drop, deduplication, whole-chip removal, hidden lookup instructions,
context tooltips, running indicators and reduced motion in both themes and a
narrow viewport. `apps/pi/backend/history` tests bounded Unicode expansion,
search, pagination, branch ancestry metadata, oversized records and archived
references; the HTTP tests verify reference resolution without transcript
content. These checks use fixtures and make no model/provider requests.
Checkbox regression checks in Git, Pi compaction and Websites ensure adjacent
text does not toggle controls while box clicks and keyboard activation do.

`tests/ui/menu-consistency.spec.ts` checks shared Select/DropdownMenu/ContextMenu,
Settings motion, desktop menu bar and Pi model choices. Selected values retain
only their checkmark; one row background follows the latest pointer or keyboard
input. Tests switch input modes without moving the pointer, reopen menus, and
cover instruction menus at 1440px/390px in both themes.

Pi context settings list the configured models and their reported context windows.
The compaction browser check switches between percentage and token budgets,
checks smaller-model caps and verifies that the chat model remains unchanged.
Instruction checks cover both editors at once, independent saves and cancellation,
unsaved-draft protection, and server revision conflicts.

`TestPiContextBudget*` verifies conversion to native Pi reserves, new-model
coverage, idempotent application, small-window caps, preservation of unrelated
settings, project overrides and the effective budget returned with chat statistics.

Compaction saves also verify an automatic idle conversation reload, an updated
context-circle threshold, refreshed settings revisions, preserved transcript and
composer drafts, deferral during active replies, and disabled budget controls
when automatic compaction is off.

### Image and HTML previews

`tests/ui/image-preview.spec.ts` opens real PNG, JPEG and WebP bytes through
mocked file APIs, checks fit and actual size, refresh, file selection, invalid
images and the size limit in light/desktop and dark/narrow layouts.
`tests/ui/html-preview.spec.ts` checks rendered HTML, inline styles, raw editing,
save/refresh and sandbox isolation without external requests. Its test disables
Playwright's service-worker blocking injection, which cannot access the worker
API in a sandboxed frame; the preview itself cannot execute scripts.
`go test ./internal/files` covers bounded binary reads and unchanged text reads;
`go test ./internal/httpapi -run '^TestFilesEndpoints$'` covers the image query.

## Calendar and Reminders

`npm run test:ui -- tests/ui/calendar.spec.ts` checks event create/edit/delete/undo,
visibility and search, all four views, overlapping timed events, both themes,
narrow layouts, protected drafts, nonexistent DST times, local reminder lists,
completion/flags/priorities, OAuth setup and the independent Pi extension toggle.
These are simulated browser checks and never contact Google.
Trackpad checks exercise continuous month rows and day/week columns in both
themes, fixed date headings and time gutters, dominant-month titles and date
highlighting, window-sized whole cells, nearest-column and nearest-hour snapping,
date and time preservation through resizing and animated maximization,
interruption of settling, range
extension and real event visibility. They also check year page tracking,
reversal, cancellation, prompt settling, pinch exclusion, reduced motion and
boundaries around search, sidebars, details, editors and Reminders.

`server/internal/calendar` tests private user storage, concurrent app/CLI writes,
optimistic revisions, recurrence across DST and invalid month dates, completion
successors, repeat limits and deduplicated alerts. Google uses a fake HTTP
transport for code/state/PKCE, Calendar-only scopes, partial consent rejection,
ETag writes and grant revocation. Gateway tests retain callback redirects and
restrict the temporary return cookie. HTTP tests check strict bodies and mutation
replay. `tests/pi-calendar.test.mjs` checks tool schemas, approval/read-only rules
and disabled tool activation; it is included in `npm run test:unit`.

Real Google sign-in requires a user-created OAuth client and consent. Offline
success does not establish a successful live Google account connection.

Desktop app checks (`tests/ui/desktop-apps.spec.ts`) cover preview, install,
update, rollback, disable, enable, uninstall and browser restoration, with
light/dark and narrow layouts. Build the production frontend first. The final
case starts a local Go gateway with real package storage and app documents;
only session authentication is stubbed. It checks opaque frame isolation,
declared metrics access and production headers. On macOS the Linux metrics
sampler has no real `/proc` values; these checks establish transport, not
Ubuntu measurement accuracy.

These tests permit service workers in Playwright's context configuration because
its injected blocking script probes `navigator.serviceWorker`, which throws in
an opaque sandbox frame. App documents explicitly forbid workers and external
requests; `tests/offline.ts` still rejects external browser traffic. No test
registers a service worker.

The `desktopapps` Go tests cover validation, syntax checking, path boundaries,
artifact integrity, concurrent/replayed changes, restart persistence and Trash
retention. HTTP tests cover session binding, capabilities and revocation.
`tests/pi-apps.test.mjs` checks tool registration, exact preview inputs and
permission enforcement. These fixtures do not call a live model provider.

The Ubuntu desktop-app browser test uses the same `lumod desktop-app` adapter
as Pi, under the authenticated test account. It builds local source, reads
real Linux metrics, reloads, updates, restores and uninstalls an app. Cached
build and runtime images need Node.js; the Docker preflight fails clearly if
it is absent. Explicit dependency preparation includes Node.js.

App storage checks cover simultaneous writers, restart and version persistence,
app isolation, stale activation rejection, bounded JSON, symlink rejection, and
recoverable clean uninstall. HTTP checks verify declared capabilities, session
binding, temporary preview isolation and error codes. The production browser
fixture creates the Counter template, checks preview/install separation, saves
and reloads data, and recovers from a two-window conflict in both themes and at
normal and narrow widths.
The Ubuntu browser suite also builds the Counter through Pi's command adapter
and verifies saved values across updates, rollback, normal reinstall and clean
uninstall/reinstall.

The Notes production-frame workflow checks close cancellation, saved-note
reopening, app-management cancellation and continuation, pending-save guards,
and preservation across external disable. Guard dialogs are checked in both
themes at 1440px and 390px. `tests/desktop-sdk.test.mjs` checks dirty-state
reporting, duplicate suppression, error codes and failed message cleanup.

React app checks require `npm run build:app-sdk` (also part of `npm run build`)
before Go tests. They verify deterministic TSX output, rejected imports and
syntax, ignored project configuration, non-execution of source, linked-entry
rejection and use of Pi's private Node.js without system Node. The production
browser and Ubuntu workflows compile a React app and verify shared controls,
unsaved-edit protection and saved data after reload.

## Required system app boundaries

`npm run test:unit` builds all 13 packages, runs the independent Pi backend and
history tests, and checks that required apps cannot be removed or replaced per
account. The resident backend test checks process reuse, software/history
contributions, private route isolation, crash restart and lifetime-pipe cleanup.
The installer checks the full required-app distribution before activation.

`npm run test:docker` repeats the backend tests in Ubuntu and exercises real
Pi chat, permission and builder workflows with offline fixtures. UI tests for
plugins, Pi assistant/conversation location, Files, Terminal, Settings and App
Library exercise loading through the host SDK and shared React instance.
