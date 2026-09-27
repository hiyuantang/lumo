# Lumo

Manage your Ubuntu server from a desktop in your browser.

Browse files, open a terminal, inspect logs and manage services in movable
windows. Lumo connects to your actual server and uses your Linux account's
permissions. Service changes made over SSH also appear in Lumo.

## What you can do

| App | Use it to |
| --- | --- |
| Monitor | View server health, per-core CPU, memory, network traffic, running processes, services and searchable logs |
| Trash | Restore deleted files or permanently remove them |
| Files | Browse folders and Trash, pin favorite folders, create files, inspect details, upload, download and edit text |
| OpenCode | Use the installed OpenCode CLI in a project terminal, with sessions and provider setup handled by OpenCode |
| Preview | Read and edit text files; switch Markdown between rendered and raw views |
| Terminal | Run commands as your Linux user |
| Skills | Browse account skills from `~/.agents/skills`, search descriptions and read their instructions |
| App Library | Discover apps, install or remove them, apply updates and view update history |
| Docker | Manage containers, images, volumes and networks; inspect logs and storage usage |
| Nginx | Manage Nginx sites for static files or local web applications |
| Settings | View server identity, inspect network details and manage time settings, adjust appearance and schedule a restart or shutdown |

Lumo manages one server per browser session. It runs command-line tools
through Terminal; it does not stream a remote graphical desktop.

## Current status

Lumo is in active development. Try it on a disposable server before using
it for important workloads. Installation from source is available; there
is no published release package yet. Full installation under systemd and
public HTTPS certificate issuance still need deployment verification.

The project targets **Ubuntu 26.04 LTS**, with **Ubuntu 24.04 LTS**
compatibility, on amd64 and arm64. The automated Docker environment uses
Ubuntu 24.04; it does not establish coverage for every supported system.

Markdown preview, dedicated storage management, user and SSH-key management,
and firewall controls are planned. Files already supports basic text editing.

## Install on your server

Copy this repository to your Ubuntu server, open its directory, and run:

```sh
sudo bash scripts/install.sh
```

The installer builds Lumo, configures HTTPS and starts its services. After
verification succeeds, it prints your browser address, username and password.
Save these details, allow the printed port through your server and provider
firewalls, then open the address and sign in.

You will need internet access and a reachable IP address or hostname.
Automatic certificates also require inbound port 80. For an existing Linux
account, your own certificate, or a private server, follow the
[installation guide](docs/INSTALL.md).

## Your first session

1. Open **Monitor** to check the server's health.
2. Use **Files** to browse your home folder. Double-click a file to open **Preview**, or right-click to edit it, show metadata in the right Details panel, download it or move it to Trash. Right-click a folder to pin it in the sidebar; select **Trash** to browse deleted items in the same window. Right-click empty space to create a file or folder. The left sidebar and Details panel work together; collapse the sidebar to icons when you need more room.
3. Open **Monitor → Services**, select a service and inspect its status or related logs.
4. Use **Terminal** when you need a command-line tool.

Ordinary file and terminal work runs with your account's permissions.
Some administrative actions ask you to confirm your password and are
recorded in an audit trail. Access to Docker containers also requires your
Linux account to have Docker access; Lumo does not grant it automatically.

Use **⌘/Ctrl+K** to find an app, **Alt+W** to close the active window, and
**Ctrl+Alt+←/→** to switch windows. Closing a window clears its open file or
project, navigation, selections and filters. Reopening starts fresh, with the
same size, position and maximized or tiled layout. Pinned folders and display
preferences are kept. Refreshing the browser restores windows that are still
open and their views for each account; terminal sessions and unsaved edits are
not restored.

Click a window’s yellow button to minimize it into the right side of the Dock.
The inset divider separates apps from minimized windows; click a window tile
to restore it. Preview’s **Open file…** button opens a compact file picker;
choose a file to view it in the current window. Opening different files from
Files creates separate Preview windows. Right-click Preview’s Dock icon and
choose **New Window** to open another, or select an existing document from the
same menu.

To use **OpenCode**, install its CLI for your Linux account following the
[official installation guide](https://opencode.ai/docs/). Open **App Library →
OpenCode** for setup instructions. After installing, refresh App Library,
then open OpenCode from the Dock and choose a project folder. Its Dock icon
appears once installation is detected. The app uses a terminal connection;
provider sign-in, model selection and permission prompts stay inside OpenCode.
Right-click its Dock icon and choose **New Window** to open another workspace.
OpenCode processes stop when their terminal tab or app window closes.

In **App Library**, select an app to read its description and manage its
installation. Installed apps offer **Uninstall**; open them from the Dock.
Uninstalling Docker or Nginx stops their services but keeps data and configuration.
Uninstalling a standalone OpenCode CLI moves its executable to Trash and keeps
projects, conversations and settings. Copies managed by another installer must
be removed with that installer.

Open **Trash** at the right end of the Dock or from the Files sidebar. Select an
item and choose **Restore** to return it to its original folder. Existing files
are never overwritten. **Delete Permanently** and **Empty Trash** ask for
confirmation; these actions cannot be undone. Lumo uses your Linux account's
home Trash; files on other filesystems cannot currently be moved there.

Files hides dot-prefixed files and folders by default. Use **View → Show Hidden Files** or **Ctrl/Cmd+Shift+H** to reveal them. Right-click a folder and choose **Open in OpenCode** to use it as a coding workspace.

Package updates are in **Settings → Updates**. Monitor’s **Activity** section shows current processes; **Logs** shows server event history.

## Upgrade, recover access or remove Lumo

Run the install command again from an updated checkout to upgrade. The
installer preserves your account and connection details; active terminal
sessions are interrupted during the upgrade.

From an SSH session on the server:

```sh
sudo lumo status
sudo lumo reset-password
sudo lumo uninstall
```

`status` shows the connection details. `reset-password` creates a new
password for an account created by the installer. For an existing account,
use the normal Linux password reset process.

Uninstall keeps Linux accounts, personal files and recovery records.
See the [removal and recovery guide](docs/INSTALL.md#uninstall) for previews,
optional removal of audit logs and backups, and older installations.

## Development and testing

See the [development and testing guide](docs/TESTING.md) for the interface
preview, visual and interaction tests, real Ubuntu Docker checks and the
remaining VM checks. Contributors should also read [AGENTS.md](AGENTS.md)
and the [clean-room rules](docs/CLEAN_ROOM.md).

## License

Lumo is licensed under the GNU Affero General Public License,
version 3 only (`AGPL-3.0-only`). See [LICENSE](LICENSE).
