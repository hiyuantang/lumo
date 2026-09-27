# Server applications

Lumo provides original web interfaces for selected software installed on the
server. The first integrations are Containers (Docker Engine) and Websites
(Nginx). Their interfaces render locally and use bounded typed requests.

## App Library

The built-in catalog has two entries. Docker opens Containers; Nginx opens
Websites. Each entry detects an existing installation or offers Install.
Missing-software screens open the matching library entry. Desktop and library
launches reuse the same app window.

Installation uses the server's configured Ubuntu APT sources: `docker.io` and
`docker-compose-v2` for Docker, or `nginx`. Lumo first simulates installation
and displays the exact packages, versions, dependencies and download size.
The user reviews this plan, confirms installation and reauthenticates when
required by policy. Apply pins the reviewed versions, refuses removals and
rechecks the plan before running. Plans expire after 15 minutes.

Progress uses the existing package worker and WebSocket subscription. Closing
the window does not cancel installation; the browser retains the request ID
so reopening resumes progress. Package operations are audited and serialized.
Packages may start services during installation and cannot be automatically
rolled back. Removing Lumo retains these packages and their application data.

No external package repository, remote script or Docker group membership is
added automatically. An administrator must grant Docker access separately if
the Linux user does not already have it; Docker socket access confers extensive
host privileges. Sign out and back in after an administrator changes groups.
Rootless and remote Docker installations are not detected by this version.

## Containers

Read Docker's system Unix socket as the authenticated Linux user. Do not grant
Docker group membership or expose the socket through the gateway. Show missing,
stopped, incompatible and permission-denied states separately. Rootless Docker,
remote engines, deployment and Compose editing are outside this first version.

List containers with their state, image and Compose project. Inspect ports,
mounts and state without returning environment variables. Fetch at most 200
recent log lines, with a bounded response and explicit refresh. Start, stop and
restart are broker actions requiring Docker socket access, polkit authorisation,
reauthentication, a current revision and audit records. No arbitrary Docker API
proxy, shell arguments or container-creation endpoint is exposed.

## Websites

Read the installed Ubuntu Nginx configuration as the authenticated user.
Existing configuration remains visible and is never rewritten automatically.
Create and edit a constrained site definition: domain, static folder or local
HTTP upstream, and enabled state. Lumo writes separate files under
`/etc/nginx/conf.d/`. A file is editable with the form only while its contents
match the supported format; externally modified files are shown as source.

Each change requires reauthentication and a matching file revision. The broker
retains a backup, writes atomically, tests the complete Nginx configuration and
requests a graceful reload. Test or reload failure restores the previous file.
The GUI reports reload acceptance rather than claiming end-to-end reachability.
Certificate issuance and arbitrary configuration editing remain future work.

New sites serve HTTP on port 80. The domain must resolve to this host and its
network rules must permit the intended traffic. Nginx must be running for a
save and reload to succeed; its existing Services view provides service
controls. Custom configuration and log files remain subject to the Linux
user's read permissions. Log views are bounded and refreshed explicitly.

## Verification

`npm run build` checks and builds the frontend. `npm test` includes mock flows
and live-protocol browser fixtures for installation review, reauthentication,
progress reconnection, permission denial, stale container state, preserved
website drafts and failed validation. Go tests cover the Docker HTTP adapter,
bounded logs, configuration restore, broker authorization and audit, strict
HTTP payloads and reviewed APT plans. These fixtures do not establish that a
real VPS installation or public domain is reachable.

## Reference specifications and original design

- [Docker Engine API v1.45](https://docs.docker.com/reference/api/engine/version/v1.45/): version negotiation, container list, inspect, logs and lifecycle operations.
- [Nginx command-line controls](https://nginx.org/en/docs/switches.html): complete configuration validation.
- [Nginx configuration reload](https://nginx.org/en/docs/control.html): graceful reload semantics.
- Lumo's [protocol](PROTOCOL.md), [privilege model](PRIVILEGE_MODEL.md) and existing shell design tokens.

The original layout uses a searchable resource list and a detail workspace,
shared confirmation sheets and compact-window layouts. Each workflow has one
app; server preferences remain in Settings.
