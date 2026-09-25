# Install Lumio OS on a VPS

The source installer targets Ubuntu 24.04 and 26.04 on amd64 or arm64,
with systemd. It creates a real Linux account, chooses an unused random
port, configures HTTPS and starts Lumio automatically at boot. The
gateway runs as an unprivileged service; files and terminals run as the
login user.

The installer is new. Unit checks, the Linux build and service definitions
pass. A contained Ubuntu check verifies HTTPS, real PAM login and requests
running as the generated Linux user. The full systemd installation gate
and public certificate issuance still need deployment verification. There
is no published release package or remote one-line installer yet.

## First installation

Copy this source checkout to your VPS. From its `lumio-os` directory:

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
binary built with `pam,webdist` can be supplied with `--binary /path/to/lumiod`.

For automatic HTTPS, allow inbound **TCP 80** through both the host and
VPS provider firewalls. The installer asks you to accept the Let's Encrypt
subscriber agreement. Port 80 must remain available for renewal. If a web
server already uses it, add `--webroot /path/to/served/webroot`; that server
must serve `/.well-known/acme-challenge/` from this directory for the chosen
IP or hostname. The installer does not stop an existing web server.

After startup and authentication checks pass, the terminal displays:

```text
Lumio OS installed successfully

Address:   https://YOUR_PUBLIC_IP:RANDOM_PORT
Username:  lumio_RANDOM
Password:  GENERATED_PASSWORD
```

Save the password, then allow the printed TCP port in the host and provider
firewalls and open the address in your browser. The installer does not
change firewall rules. Use `--port 48123` if you need to reserve a port in
advance; otherwise it selects an unused port between 20000 and 59999.

The generated account has its own home directory and a random 32-character
password. It belongs to `lumio-users`, `lumio-admin` and `systemd-journal`.
It receives no `sudo` or Docker group membership. Elevated Lumio actions
use the typed broker and require password reauthentication. This account
is also subject to the host's existing SSH login policy.

## Existing account or certificate

Use an existing non-root Linux account without changing its password:

```sh
sudo bash scripts/install.sh --host desktop.example.com --user alice
```

This grants the account Lumio login, journal access and the broker's
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
sudo lumioctl renew-certificate
```

For unattended automatic issuance, `--accept-acme-terms` explicitly accepts
the [Let's Encrypt subscriber agreement](https://letsencrypt.org/repository/).
An optional `--email you@example.com` supplies the certificate account email.

## Upgrades and recovery

Run `sudo bash scripts/install.sh` from the updated source checkout.
It preserves the address, port, account and password, and restarts the
services. Active terminal sessions are interrupted. On activation failure,
it attempts to restore the previous Lumio binary, service configuration,
certificate selection and renewal timer. Installed OS/build packages and
certificate-authority changes are not rolled back.

After a failed first installation, rerun the same command. The saved pending
account and port are reused; a fresh password is generated and printed only
after verification succeeds.

```sh
sudo lumioctl status
sudo lumioctl reset-password
```

`status` prints the address and username. Lumio stores no plaintext password
copy. `reset-password` generates and prints a new password for an
installer-created account and ends active sessions. For an existing account,
use the normal `sudo passwd USER` workflow.

Check startup and renewal errors with:

```sh
sudo systemctl status lumiod-gateway lumiod-sessiond lumiod-broker
sudo journalctl -u lumiod-gateway -u lumiod-sessiond -u lumiod-broker
sudo systemctl status lumio-cert-renew.timer
sudo journalctl -u lumio-cert-renew.service
```

The root-only install record is `/etc/lumio/install.json`; the binary and
management script are under `/usr/local/lib/lumio`. Active certificate files
are under `/etc/lumio/tls/current`, readable only by root and `lumio-gw`.
The installer uses systemd units in `/etc/systemd/system`, the PAM service
`/etc/pam.d/lumiod` and a Lumio-specific polkit rule. It never installs the
Docker testbed's authorization rules.

## Transport and verification

Public gateway listeners require HTTPS. Loopback HTTP remains available for
development through an SSH tunnel. The explicit `-insecure-http` flag is
reserved for isolated test containers and is absent from installed units.

IP certificates use Let's Encrypt's short-lived profile. A systemd timer
checks renewal hourly and reloads the certificate without restarting the
gateway. Invalid certificate reloads preserve the currently loaded pair.
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
`python3 /opt/lumio-test/scripts/install-container-check.py` to verify fresh
installation, upgrade stability, password reset, HTTPS and renewal. This
test creates Linux accounts and changes system services; it is intended
only for the disposable test environment. Public ACME issuance and external
firewall reachability need a separate check on the target VPS.
