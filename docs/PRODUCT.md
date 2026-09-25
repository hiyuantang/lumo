# Lumio OS — Product

## Definition

*A locally rendered, macOS-inspired web desktop for administering a real headless Ubuntu server.*

The main workflow is everyday work on a VPS: browse files, edit Markdown
and text, use a terminal and manage the system through a familiar desktop.
Users install Lumio OS on the VPS and access it from a local browser at
`https://VPS-IP:port` or a configured hostname.

The browser draws the desktop, applications and document previews locally.
The VPS provides real files, command execution and system capabilities.
Low bandwidth use for these workflows is a product priority.

## Target user

A developer or small-team operator running one or a few headless Ubuntu
servers (VPS or homelab) who wants GUI clarity without giving up SSH or
normal Linux permissions.

## Operating principles

1. The real server is the source of truth.
2. Changes made through SSH must immediately appear in the GUI.
3. Users retain their normal Linux permissions.
4. Privilege elevation uses existing Linux mechanisms.
5. The application has little or no idle server footprint.
6. The UI uses real system APIs rather than maintaining a competing
   configuration database.
7. Typing, scrolling, window movement and Markdown preview render locally.
   Network traffic carries requested file contents, saves, terminal text
   and system data. File transfers and embedded media still consume data.

## Application scope

- Build focused web interfaces for selected Linux capabilities: Files,
  Terminal, Markdown editing and the system-management tools below.
- Command-line applications remain usable through Terminal without a
  custom interface for each program.
- Software with its own web interface can be accessed separately through
  that interface. Embedding or integrating third-party web apps is a
  separate feature and must preserve the shell's trust boundary.
- Native graphical applications and full remote desktops are not streamed.
  Recreating arbitrary desktop applications as web apps is outside scope.

Other software can still be installed and run on the VPS; Lumio does not
provide a graphical interface for every installed program.

## Core applications

| Application | Scope | Status |
|---|---|---|
| Home | Health, uptime, CPU, memory, storage, updates and alerts | Phase 2 complete |
| Files | Real filesystem plus protected configuration repair | Phase 5 complete |
| Markdown editor | Edit server Markdown/text files with a local preview | Planned; basic text editing already exists in Files |
| Terminal | A real PTY running as the logged-in Linux user | Phase 3 complete |
| Services | systemd units, dependencies, startup and restart operations | Phase 5 complete |
| Logs | journald with live filters and saved searches | Phase 5 complete |
| Updates | Package refresh, upgrade plan, installation and reboot status | Phase 5 complete |
| Storage | Disks, partitions, mounts, filesystems and SMART status | planned |
| Network | Interfaces, addresses, DNS, routes, listeners and firewall | Phase 6 in progress: live interfaces and typed Netplan transactions with dead-man rollback |
| Containers | Docker or Podman containers, images, logs and Compose projects | planned |
| Settings | Users, SSH keys, security, TLS, locale, time and product settings | Phase 6 in progress: reauthenticated power controls |

## Markdown editing workflow

The next editor increment builds on the existing Files text editor:

1. Open a Markdown file from Files and load its contents and revision.
2. Edit the source and view a preview rendered locally, with no server
   request needed for each keystroke or preview update.
3. Save to the same path on the VPS using the logged-in user's permissions.
4. Preserve unsaved work when saving fails or the connection drops, and
   warn before closing or navigating away from a modified document.
5. If another tool changed the file, retain the local edits and offer
   explicit recovery choices instead of overwriting the newer version.

Previewing a document must not execute document-supplied scripts or active
HTML. External media should load only on an explicit user request so that
opening a text document does not silently start large transfers. Truncated
or unsupported files must not be saved as if their full contents loaded.

Acceptance: edit and preview a real `.md` file, save it, and verify the same
contents over SSH. Repeat with a concurrent SSH edit, a denied write and a
failed connection; local work must survive each failed save. Check that
typing and previewing make no network requests. These are planned checks,
not claims that the Markdown workflow is already implemented.

## First useful release

The first meaningful release lets a user:

1. Install one Ubuntu package.
2. Connect over HTTPS by VPS IP and port or a configured hostname, without
   needing an SSH tunnel for normal use.
3. Log in as a real Linux user.
4. See a macOS-inspired desktop.
5. Inspect host health.
6. Browse permitted files.
7. Use a real terminal.
8. Inspect and control systemd services.
9. Search and stream journal logs.
10. Plan and apply updates.
11. Elevate only for defined actions.
12. Recover after reconnecting.
13. See an audit trail.
14. Observe changes made through SSH.
15. Uninstall the product without damaging the server.
16. Edit and preview Markdown locally and safely save it to the VPS.

It explicitly does not include:

- Multiple hosts in one browser session.
- A plugin marketplace.
- Every Cockpit feature.
- Native graphical application or full-desktop streaming.
- Custom web versions of arbitrary desktop applications.
- Kubernetes.
- Complete storage provisioning.
- An autonomous AI administrator.
- An exact macOS visual replica.

## Naming and branding

- The product name is **Lumio OS**.
- Original logo and iconography are pending; all branding, visual assets,
  typography, icons and window controls are original work.
- Never use Apple or Cockpit assets.
