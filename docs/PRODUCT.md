# Lumo — Product

## Definition

*A locally rendered, macOS-inspired web desktop for administering a real headless Ubuntu server.*

The main workflow is everyday work on a VPS: browse files, edit Markdown
and text, use a terminal and manage the system through a familiar desktop.
Users install Lumo on the VPS and access it from a local browser at
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
- Local desktop apps can be created by Pi, previewed in isolated windows and
  installed without rebuilding Lumo. The first SDK supports JavaScript/CSS
  and optional read-only CPU and memory access.
- Command-line applications remain usable through Terminal without a
  custom interface for each program.
- Software with its own web interface can be accessed separately through
  that interface. Embedding or integrating third-party web apps is a
  separate feature and must preserve the shell's trust boundary.
- Native graphical applications and full remote desktops are not streamed.
  Recreating arbitrary desktop applications as web apps is outside scope.

Other software can still be installed and run on the VPS; Lumo does not
provide a graphical interface for every installed program.

## Core applications

| Application | Scope | Status |
|---|---|---|
| Home | Health, uptime, CPU, memory, storage, updates and alerts | Phase 2 complete |
| Files | Real filesystem plus protected configuration repair | Phase 5 complete |
| Preview | Read text and Markdown in an independent window; switch between raw and rendered Markdown | Available |
| Markdown editor | Edit server Markdown/text files with a local preview | Planned; basic text editing already exists in Files |
| Terminal | A real PTY running as the logged-in Linux user | Phase 3 complete |
| Services | systemd units, dependencies, startup and restart operations | Phase 5 complete |
| Logs | journald with live filters and saved searches | Phase 5 complete |
| Updates | Installed APT inventory, grouped available updates, installation and reboot status | Phase 5 complete |
| Storage | Disks, partitions, mounts, filesystems and SMART status | planned |
| App Library | Discover, install and manage supported apps | Docker, Nginx and Pi; direct installation with compact header progress, then Uninstall |
| Docker | Containers, logs, images, volumes, networks and storage usage | Initial implementation; resource creation/removal guards; deployment, Compose editing and Podman remain planned |
| Nginx | Nginx static sites, local HTTP proxies, configuration and logs | Initial implementation; validation, backups and reload; certificate issuance remains planned |
| Settings | Server identity, network, time, appearance and system controls; users, SSH keys, security, TLS, locale, listeners and firewall remain planned | Phase 6 in progress: read-only server identity, reauthenticated time edits, read-only network details, local appearance and power controls |

Network is a read-only section inside Settings for viewing and copying IP
addresses, interface status, default gateways, DNS servers and MAC addresses.
Network changes are made through SSH or the server’s network tools. Basic
network details do not depend on Netplan. Monitor shows live traffic activity.
Command Center opens Network in the existing Settings window. Software Updates
is available inside Settings; Services remains a separate application.

Software Updates puts Needs updates first, with security updates followed by
System, Third-party and Other / unknown groups. Other installed packages appear below
in one alphabetical list with local search, a source-filter dropdown, versions
and held status. Each package appears once; after an
update completes it moves into the installed section. The page shares Settings
headings, grouped cards and scrolling, with compact name and version rows. Lists load
in batches of 50 rows. Reading or refreshing the view uses saved APT information;
Check for updates explicitly refreshes repository metadata. Install updates
confirms the exact package changes and download size before applying the saved
plan. Completed updates leave the pending list and refresh installed versions.

App Library installs the server software needed by Docker and Nginx and
opens those same applications. Its server-software catalog is curated, with no
third-party plugin upload or arbitrary installation scripts. Packages already
installed outside Lumo are detected. See [server applications](SERVER_APPS.md).

App Library also manages local desktop app builds created through Pi. Discovery
provides preview and installation; Updates provides version changes and history.
Installed apps join the dock and search, retain previous versions for rollback,
and support disable and recoverable uninstall. See [App Platform](APP_PLATFORM.md)
for the package format, permission limits and recovery workflow.

## Menus

The menu bar starts with the bold active app name, followed by File, Edit,
View and Window. With no selected window it defaults to Files. Common
commands retain their positions and appear disabled when unavailable;
app commands come from the selected window. The app menu holds preferences
and Quit, which checks every document for unsaved changes. File handles
opening, creating, uploading and saving. Edit handles text history and
clipboard operations. View controls content and panels; Window controls
placement, sizing and switching. Help is omitted.

Toolbars keep information on the left and related actions on the right:
view controls, file actions, then the primary action. Files uses anchored
New and View dropdowns with keyboard navigation.

Preview has two Markdown views: Rendered and editable Raw. Other complete
text files open directly in an editor with Save always visible. Auto-save
is an account preference in the Preview menu, initially off. When enabled,
it saves after a short typing pause and preserves edits typed during a
write. Failed writes pause auto-save and keep the draft. Conflicts require
reloading the current server version or saving a separate copy. Refresh,
opening another document, closing, and quitting protect unsaved changes.

Right-click menus act on the clicked item: files and folders, terminal tabs
and output, service units, log entries, Preview documents, skills and Trash
items. Keep each menu limited to actions relevant to that item. Text fields
retain clipboard actions. Empty desktop areas, window title bars and generic
application backgrounds have no custom menu.

File and View in the top bar hold common launch and window commands. Theme
and motion controls live in Settings; appearance searches in Command Center
open that Settings section. Dock menus offer running-window actions and new
windows where supported; a closed app with only an Open action needs no menu.
Destructive item actions reuse the same confirmation and authorization flow
as their visible controls.

Files has Back and Forward controls followed by the current folder name.
Its sidebar shows Home, existing standard user folders from the server’s XDG
configuration, Trash, and user-pinned folders. Missing or disabled standard folders
are omitted; discovering locations never creates directories. Customized and
localized paths are honored, and pinned folders do not appear twice.
The bottom path contains clickable folder segments and a Copy action for the
selected item or current folder's absolute path. It has no path-edit field.
View offers List and Grid, with ascending or descending sorting by name,
type, size or modified date. View and sorting preferences are retained.

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

- The product name is **Lumo**.
- Original logo and iconography are pending; all branding, visual assets,
  typography, icons and window controls are original work.
- Never use Apple or Cockpit assets.

## File gestures and window overview

Files supports rectangle selection in List and Grid views, Command/Control-click
for multiple selections, Shift-click for ranges, and Command/Control-A for all
visible items. Drag selected files and folders onto another folder, Home, a pinned
folder, or a path-bar ancestor to move them. Drop onto the Files Trash location,
the Trash window, or the dock's Trash icon to move them to recoverable Trash.
Existing destination names are never overwritten. Cross-filesystem moves are
currently rejected with an explanation; successful items in a multi-item move
are retained when another item fails.

Floating windows may extend beyond the left, right and bottom desktop edges.
A draggable section of the title bar remains reachable above the dock, and the
title bar cannot move above the menu bar. Maximized and tiled windows stay within
the work area. Resizing the desktop brings floating windows back into view.

The dock's Overview control spreads all open windows across the desktop, including
minimized windows. Two-dimensional packing finds a large shared scale while
preserving proportions, then spreads windows into free space without fixed rows.
The layout recalculates when the desktop resizes. Windows animate from their
desktop or dock positions into the overview and back on exit; reduced motion
skips these transitions. Choosing a window brings it forward and restores it if
needed, preserving its session. Escape or the surrounding background closes
Overview. The empty state also offers Done. Labels appear on hover or keyboard
focus, and arrow keys navigate windows. A top-right close button appears on hover
or keyboard focus (always available on touch). It closes only that window and
rearranges the remaining previews; unsaved edits return to their confirmation
prompt before anything is discarded. The menu bar and dock remain visible;
windows fill the desktop space between them. Overview does not create an
application window.


## Server clock and Pi installation

The menu-bar clock and Settings clock use the server's reported time and time
zone. Saving the time zone changes the Ubuntu setting and updates both clocks.
UTC is displayed as “UTC” while the server identifier remains `Etc/UTC`.

App Library installs Pi with npm for the signed-in Linux account. Installation
requires Node.js 22.19 or newer. Versioned updates participate in Updates and Update all,
with progress and account-specific installed update history. Running operations
continue when App Library closes and prevent the user agent's idle shutdown.


## App uninstall choices

Uninstall opens one compact dialog with two choices. **Uninstall** is selected
by default and keeps settings and stored data. **Clean uninstall** also moves
settings, caches and stored app data to Trash, including Pi conversations
and standard Docker containers, images and local volumes. Each choice has one short description. Website content and project folders stay
in place. Trash can restore removed data without overwriting newer files;
protected server data retains its ownership and permissions. Custom or shared
Docker storage that cannot be safely isolated requires normal uninstall.

### Standard folder locations

Settings → Folders manages each standard folder independently. Each compact row
shows its name, a parent-path selector and right-aligned Apply; missing or disabled folders offer Add.
Offer conventional paths under Home and available storage, plus a folder picker.
The selector shows only the parent path; the folder is placed beneath it.
Changing a location moves its contents, preserving other folders and settings.
Preflight every entry and stop without changes on any same-name conflict.
Remove asks for confirmation, moves the whole folder and contents to recoverable
Trash, and disables the shortcut. A disabled Desktop also clears desktop icons.
Restoring from Trash recovers the folder; Add enables its standard-folder role again.
Do not create folders until explicitly added. File sizes appear in Files Details,
not beside items in the list or grid; sorting by size remains available.

### Desktop files

The wallpaper shows the contents of the server's configured Desktop folder.
Items start at the top right, fill downward, then continue in columns to the
left, staying below the menu bar and above the dock. Hidden files are omitted.
Long names are clamped with the full name available on hover. Double-click or
Enter opens folders in Files and files in Preview. Items support modifier selection and drag-to-select rectangles,
then dragging the whole selected group to Files, folders or Trash and context actions. Local file changes refresh
the desktop immediately; external changes are checked on browser focus and every
30 seconds while the page is visible. A missing Desktop folder leaves the
wallpaper empty; this feature does not create it.


## Pi workspace

Pi replaces the former terminal-only coding app. New chat opens a centered
composer in the current workspace, with a folder selector below and model
controls on the right. Choose a workspace with the folder picker or by dropping
a folder from Files onto the selector. Attach and Files drag-and-drop add compact file cards with an icon, filename
and remove control, without previewing, uploading or moving files. On send,
Pi receives `read: "<absolute path>", "<absolute path>"` followed by a blank line
and the user prompt. The composer and conversation display file cards instead
of that prefix. Workspace changes preserve the draft and attachments. A collapsible sidebar lists saved project sessions with space between
folder and chat highlights; the main pane renders conversation text and
expandable tool activity.
User messages use narrow right-aligned bubbles; Pi replies stay left-aligned.
Hover or keyboard focus reveals copy controls and Pi message timestamps in the
server time zone. Missing timestamps are omitted. Touch devices show controls
without hover. The latest completed reply offers native Branch chat, which clones
the current conversation without sending a prompt and preserves the original.
The composer combines model and effort in one button, with the model name and a
muted effort label. It opens a card above the button: a centered current effort value, a centered model
picker without a background fill, and a thick rounded effort slider with blue fill, subtle stops, and a
white thumb. The card omits the Effort heading and labels below the slider. Slider stops follow Pi's supported
levels and save on release; fixed-effort models disable adjustment. The compact
model list places names on the left and providers on the right, without search; the composer button omits them. Keyboard
arrows adjust effort; Escape returns focus, and clicking outside dismisses the
card. Composer controls animate hover and press states, respecting reduced motion.
Steering, follow-up while working, and Stop remain available. Rename and Compact are secondary actions.
Switching sessions resumes Pi's own saved conversation. Closing an active task
or discarding an unsent draft requires confirmation.

Provider connection uses native Settings controls backed by Pi's public SDK.
The installed provider catalog supplies API-key and browser sign-in methods;
links, device codes, choices and input prompts appear inside Lumo. Extensions
and prompt-template menus are deferred. The initial native runtime ignores
trust-gated project-local resources; it does not grant project trust silently.
The former app's installed files and conversations are left intact by migration.


Pi's sidebar uses flat rows: New chat, workspace folders with always-visible indented
chats, and collapsible Recents across previously opened projects. Recents animates
open and closed, respecting reduced motion, and remembers its expansion choice
per account across reopening and refresh. New workspaces are added by starting a
new chat and selecting its workspace; the sidebar has no Add project button.
Workspace shortcuts are
per-account browser preferences; chat titles and history come from the server.
Lists reveal additional entries with Show more. Titles remain one line with
ellipsis, and the current project chat uses a quiet rounded highlight.
Conversations start directly with messages, without a repeated project header.
Workspace rows reveal options and New chat controls on hover or keyboard focus.
New chat starts in that workspace. The options menu changes the saved display
name without renaming the folder, reveals the folder in Files, or archives the
workspace's listed chats after confirmation. Bulk archival stops and reopens
the idle connection once, preserving the draft; partial successes remain
restorable in Archived chats.
Each conversation row has a right-side Archive action on hover or keyboard
focus, always visible on touch screens. One click archives the chat without
confirmation, preserving its original Pi file and the unsent composer draft.
The active chat opens a fresh conversation after archival. Running replies must
be stopped first; another window using the same project blocks the move.
Archived chats disappear from both Projects and Recents.

A persistent icon-only rail spans the left edge of Pi, with Home at the top
and Settings at the bottom, including before a project is open. Home returns to
the current conversation without restarting it or losing the composer draft.
Settings replaces the conversation area with a left navigation card and a right
content pane. Providers, Instructions and Archived chats are separate vertical
tabs. Unsaved instruction edits remain when switching tabs or returning Home;
closing Pi still warns about those edits. Archived chats lists the account's archived conversations
across projects, with Restore, Delete, and Delete all. Permanent deletion
confirms before removing conversation files; active chats, project files, and
credentials are preserved. Provider connection lives in Settings, and Pi manages credentials
in the user's agent directory. Setup never opens a terminal. Returning resumes the previous saved
session and preserves the composer draft. The instruction editor reads and saves
Pi's actual user-wide instruction file and optional `APPEND_SYSTEM.md`, separately
from project instructions. Unsaved edits are protected, concurrent server changes
cause a conflict, and changes apply when a project is reopened. No browser copy
of these instruction files is treated as the source of truth.

Pi's Stop action clears pending work before interrupting the active reply, and
returns any still-queued text to the composer without replacing its draft.
Take back retrieves pending messages while the current reply continues. A message
already delivered cannot be recalled. Edit & resend lists the active branch's
user messages with stable IDs, starts a new saved chat before the chosen message,
and submits the edited text. The original chat remains available. This changes
conversation history only; it does not restore files or undo executed commands.

Pi’s collapsed conversation sidebar retains Expand and New chat. Home and Settings stay in the separate persistent app rail. It animates between widths and respects reduced motion. Refreshing the browser reconnects the existing project runtime and conversation.
