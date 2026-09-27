# Install and uninstall Lumo on a VPS

The source installer targets Ubuntu 24.04 and 26.04 on amd64 or arm64,
with systemd. It creates a real Linux account, chooses an unused random
port, configures HTTPS and starts Lumo automatically at boot. The
gateway runs as an unprivileged service; files and terminals run as the
login user.

The installer is new. Unit checks, the Linux build and service definitions
pass. A contained Ubuntu check verifies HTTPS, real PAM login and requests
running as the generated Linux user. The full systemd installation gate
and public certificate issuance still need deployment verification. There
is no published release package or remote one-line installer yet.

## Commands at a glance

Run the install command from a copy of this repository on the VPS.
The installed `lumo` command works from any directory. Older installations
use `lumoctl`; rerun the source installer to add `lumo`. The old name remains
available as a compatibility alias after upgrading.

| Action | Command |
| --- | --- |
| Install | `sudo bash scripts/install.sh` |
| Uninstall, keeping recovery records | `sudo lumo uninstall` |
| Uninstall and delete Lumo recovery records | `sudo lumo uninstall --purge` |
| Preview removal | `sudo lumo uninstall --dry-run` |

Both uninstall modes keep Linux accounts and personal files. Removal asks
for confirmation; `--purge` explicitly includes permanent deletion of
Lumo's audit logs and rollback backups.

## First installation

Copy this source checkout to your VPS. From its `lumo` directory:

```sh
sudo bash scripts/install.sh
```

The installer detects a public IPv4 address on the host, or asks for an
address. For a VPS behind NAT, or to use a hostname, specify it explicitly:

```sh
sudo bash scripts/install.sh --host YOUR_PUBLIC_IP
```

It builds the live frontend and a Linux binary with PAM authentication.
This needs internet access for Ubuntu packages, npm dependencies, Go and
Go modules, and enough memory and disk space to compile them. A prepared
binary built with `pam,webdist` can be supplied with `--binary /path/to/lumod`.

For automatic HTTPS, allow inbound **TCP 80** through both the host and
VPS provider firewalls. The installer asks you to accept the Let's Encrypt
subscriber agreement. Port 80 must remain available for renewal. If a web
server already uses it, add `--webroot /path/to/served/webroot`; that server
must serve `/.well-known/acme-challenge/` from this directory for the chosen
IP or hostname. The installer does not stop an existing web server.

After startup and authentication checks pass, the terminal displays:

```text
Lumo installed successfully

Address:   https://YOUR_PUBLIC_IP:RANDOM_PORT
Username:  lumo_RANDOM
Password:  GENERATED_PASSWORD
```

Save the password, then allow the printed TCP port in the host and provider
firewalls and open the address in your browser. The installer does not
change firewall rules. Use `--port 48123` if you need to reserve a port in
advance; otherwise it selects an unused port between 20000 and 59999.

The generated account has its own home directory and a random 32-character
password. It belongs to `lumo-users`, `lumo-admin` and `systemd-journal`.
It receives no `sudo` or Docker group membership. Elevated Lumo actions
use the typed broker and require password reauthentication. This account
is also subject to the host's existing SSH login policy.

## Existing account or certificate

Use an existing non-root Linux account without changing its password:

```sh
sudo bash scripts/install.sh --host desktop.example.com --user alice
```

This grants the account Lumo login, journal access and the broker's
explicit administrative actions. It prints the username and address;
the existing password is never printed or replaced.

Use your own PEM certificate chain and key instead of automatic issuance:

```sh
sudo bash scripts/install.sh --host desktop.example.com \
  --cert /path/to/fullchain.pem --key /path/to/privkey.pem
```

The certificate must match the chosen IP or hostname and have at least
one day of validity. Private test hosts need their own certificate, trusted
by their clients. Keep the source files at these paths. After your external
certificate manager renews them, run:

```sh
sudo lumo renew-certificate
```

For unattended automatic issuance, `--accept-acme-terms` explicitly accepts
the [Let's Encrypt subscriber agreement](https://letsencrypt.org/repository/).
An optional `--email you@example.com` supplies the certificate account email.

## Upgrades and recovery

Run `sudo bash scripts/install.sh` from the updated source checkout.
It preserves the address, port, account and password, and restarts the
services. Active terminal sessions are interrupted. On activation failure,
it attempts to restore the previous Lumo binary, service configuration,
certificate selection and renewal timer. Installed OS/build packages and
certificate-authority changes are not rolled back.

After a failed first installation, rerun the same command. The saved pending
account and port are reused; a fresh password is generated and printed only
after verification succeeds.

```sh
sudo lumo status
sudo lumo reset-password
```

`status` prints the address and username. Lumo stores no plaintext password
copy. `reset-password` generates and prints a new password for an
installer-created account and ends active sessions. For an existing account,
use the normal `sudo passwd USER` workflow.

Check startup and renewal errors with:

```sh
sudo systemctl status lumod-gateway lumod-sessiond lumod-broker
sudo journalctl -u lumod-gateway -u lumod-sessiond -u lumod-broker
sudo systemctl status lumo-cert-renew.timer
sudo journalctl -u lumo-cert-renew.service
```

The root-only install record is `/etc/lumo/install.json`; the binary and
management script are under `/usr/local/lib/lumo`. Active certificate files
are under `/etc/lumo/tls/current`, readable only by root and `lumo-gw`.
The installer uses systemd units in `/etc/systemd/system`, the PAM service
`/etc/pam.d/lumod` and a Lumo-specific polkit rule. It never installs the
Docker testbed's authorization rules.

## Uninstall

```sh
sudo lumo uninstall
```

The command prints what it will remove and asks you to type `uninstall`.
Run it over SSH or the VPS console: uninstall ends Lumo browser sessions
and terminals. Removal from a Lumo-managed terminal is rejected before
stopping its own session; previews remain available there. A failed service
stop leaves the installer and its record
in place so the command can be retried.

It stops and disables the gateway, session daemon, broker and certificate
renewal; removes their units and drop-ins, program files, runtime sockets,
PAM and polkit integration, and managed HTTPS files. It removes only group
memberships recorded as added by the installer, and deletes installer-created
groups only when they are empty and are nobody's primary group.

It keeps:

- Linux login and service accounts, home folders, SSH keys and personal files.
- Audit logs and protected-file rollback copies under `/var/lib/lumo`.
- Shared Ubuntu packages and certificates you supplied yourself.
- Existing firewall rules and system changes you made through Lumo.

For a purge that also deletes Lumo's audit logs and rollback copies:

```sh
sudo lumo uninstall --purge
```

This asks you to type `purge`. It still preserves Linux accounts and personal
files. Historical Lumo messages in the shared system journal remain subject
to the host's journal retention policy.

Preview either mode without changing files, services or group membership:

```sh
sudo lumo uninstall --dry-run
sudo lumo uninstall --purge --dry-run
```

For unattended removal, add `--yes` to the chosen uninstall command. A
non-interactive invocation without that flag stops without removing anything.

For an older installation without this command, or a partial installation,
run the current source checkout's installer in uninstall mode:

```sh
sudo bash scripts/install.sh uninstall
```

The same fallback works after `lumo` has been removed. For example, to
delete recovery records retained by an earlier safe uninstall:

```sh
sudo bash scripts/install.sh uninstall --purge
```

Repeated removal is safe. New installs keep certificate issuance state in
private Lumo directories and record which certificate runtime and group
memberships they introduced. Older installs without this ownership history
keep untracked group memberships, certificate tooling and certificates under
`/etc/letsencrypt`; the uninstaller reports those retained resources.

After removal, you can close the printed Lumo TCP port in the host/provider
firewall. Keep port 80 if another service uses it. The source checkout is
retained. A temporary installation lock under `/run/lock` is kept until reboot
so concurrent management commands continue to share the same lock.

## Transport and verification

Public gateway listeners require HTTPS. Loopback HTTP remains available for
development through an SSH tunnel. The explicit `-insecure-http` flag is
reserved for isolated test containers and is absent from installed units.

IP certificates use Let's Encrypt's short-lived profile. A systemd timer
checks renewal hourly and reloads the certificate without restarting the
gateway. Invalid certificate reloads preserve the currently loaded pair.
New installations isolate Certbot's config, work and log directories under
`/etc/lumo`, using its documented
[directory options](https://eff-certbot.readthedocs.io/en/stable/using.html#lock-files).
See the official [IP certificate guide](https://letsencrypt.org/2026/03/11/shorter-certs-certbot),
[HTTP challenge requirements](https://letsencrypt.org/docs/challenge-types/)
and [Certbot flags](https://eff-certbot.readthedocs.io/en/stable/using.html).

Installer unit checks:

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s scripts/tests -v
```

`docker/Dockerfile.install-test` builds an Ubuntu test image with a real
PAM-enabled binary and the live UI. On a disposable Ubuntu systemd
environment prepared with that image, run
`python3 /opt/lumo-test/scripts/install-container-check.py` to verify fresh
installation, upgrade stability, password reset, HTTPS and renewal. This
test also exercises uninstall, personal-file preservation and purge. It
creates Linux accounts and changes system services; it is intended
only for the disposable test environment. Public ACME issuance and external
firewall reachability need a separate check on the target VPS.

An ordinary container can verify filesystem cleanup and real Linux group
membership without host mounts, networking or privileged mode:

```sh
docker build -f docker/Dockerfile.install-test -t lumo-install-test .
docker run --rm --network none --entrypoint python3 lumo-install-test \
  /opt/lumo-test/scripts/uninstall-container-check.py
```

This contained check simulates service-manager calls. It does not verify
systemd boot or service shutdown; those remain part of the full systemd gate.
