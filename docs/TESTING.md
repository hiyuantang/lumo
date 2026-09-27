# Development and testing

Lumo separates interface checks from real Ubuntu operations. Simulated data
keeps visual checks predictable; only tests against Ubuntu establish that
an operation actually changes the server.

## Test commands

Run commands from the repository root after `npm ci` and the one-time
browser setup, `npx playwright install chromium`.

| Command | Responsibility |
| --- | --- |
| `npm run build` | Typecheck the app and tests; build the live frontend |
| `npm run test:ui` (or `npm test`) | Browser appearance, layout, keyboard interaction, dialogs, drafts and error presentation using simulated data |
| `npm run test:ui:production` | Build the shipped frontend and check OpenCode terminal rendering and setup |
| `npm run test:unit` | Go logic and edge cases, plus Python installer and uninstaller checks |
| `npm run test:docker` | Real Ubuntu backend operations, Linux/PAM-enabled Go tests and a small browser-to-Ubuntu workflow suite |
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

The production terminal check replays the capability queries emitted by
OpenCode at startup. Run `npm run test:ui:production` when changing terminal
dependencies or build settings. Syntax minification is disabled in
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

The runner builds `docker/Dockerfile.ubuntu24`, including the production
frontend and PAM-enabled backend. It starts systemd, D-Bus, the gateway,
session service and privileged broker inside a fresh Ubuntu 24.04 container.
The image build also runs the Go tests on Linux with PAM enabled.

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
removes its container on exit, retains the cached image, removes the login
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

Real Docker Engine and Nginx application workflows also need dedicated
system integration coverage; the interface fixtures and adapter unit tests
alone do not prove installation or administration on a VPS.

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
