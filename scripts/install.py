# SPDX-License-Identifier: AGPL-3.0-only
import argparse
import contextlib
import errno
import fcntl
import grp
import hashlib
import http.client
from http.cookies import SimpleCookie
import ipaddress
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import shutil
import socket
import ssl
import subprocess
import sys
import tarfile
import tempfile
import time
import urllib.request

ROOT = Path(__file__).resolve().parent.parent
CONFIG = Path('/etc/lumio/install.json')
LIB = Path('/usr/local/lib/lumio')
TLS = Path('/etc/lumio/tls')
CERTBOT = Path('/opt/lumio-certbot/bin/certbot')
SERVICES = ['lumiod-broker', 'lumiod-sessiond', 'lumiod-gateway']


def run(args, *, capture=False, data=None, cwd=None, env=None):
    result = subprocess.run([str(a) for a in args], input=data, text=True, cwd=cwd, env=env,
                            stdout=subprocess.PIPE if capture else None, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()}')
    return result.stdout or ''


def write(path, data, mode=0o644, group=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data.encode() if isinstance(data, str) else data)
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), mode)
            if group is not None:
                os.fchown(stream.fileno(), 0, grp.getgrnam(group).gr_gid)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def load_config():
    return json.loads(CONFIG.read_text()) if CONFIG.exists() else None


def save_config(config):
    write(CONFIG, json.dumps(config, indent=2) + '\n', 0o600)
    os.chmod(CONFIG.parent, 0o755)


def validate_host(host):
    host = host.strip().strip('[]')
    try:
        return str(ipaddress.ip_address(host))
    except ValueError:
        if len(host) <= 253 and all(re.fullmatch(r'[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?', label)
                                    for label in host.split('.')) and '.' in host:
            return host.lower()
        raise ValueError('Enter a public IP address or a full hostname, without a scheme or port.')


def public_host():
    addresses = json.loads(run(['ip', '-j', 'address', 'show', 'scope', 'global'], capture=True))
    for interface in addresses:
        for address in interface.get('addr_info', []):
            value = address.get('local', '')
            if address.get('family') == 'inet' and ipaddress.ip_address(value).is_global:
                return value
    if not sys.stdin.isatty():
        raise ValueError('Supply --host with the VPS public IP or hostname.')
    return input('VPS public IP or hostname: ')


def available_port(port):
    with contextlib.ExitStack() as stack:
        try:
            ipv4 = stack.enter_context(socket.socket(socket.AF_INET, socket.SOCK_STREAM))
            ipv4.bind(('0.0.0.0', port))
            if socket.has_ipv6:
                try:
                    ipv6 = stack.enter_context(socket.socket(socket.AF_INET6, socket.SOCK_STREAM))
                    ipv6.setsockopt(socket.IPPROTO_IPV6, socket.IPV6_V6ONLY, 1)
                    ipv6.bind(('::', port))
                except OSError as error:
                    if error.errno not in (errno.EAFNOSUPPORT, errno.EADDRNOTAVAIL, errno.ENODEV):
                        raise
            return True
        except OSError:
            return False


def choose_port(requested=None):
    if requested is not None:
        if not 1024 <= requested <= 65535 or not available_port(requested):
            raise ValueError('The requested port must be unused and between 1024 and 65535.')
        return requested
    for _ in range(128):
        port = 20000 + secrets.randbelow(40000)
        if available_port(port):
            return port
    raise RuntimeError('Could not find an unused port.')


def choose_username():
    for _ in range(128):
        username = 'lumio_' + secrets.token_hex(3)
        try:
            pwd.getpwnam(username)
        except KeyError:
            return username
    raise RuntimeError('Could not create a unique username.')


def require_host():
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('Run with sudo on Ubuntu 24.04 or 26.04.')
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID', '').strip('"') != 'ubuntu' or release.get('VERSION_ID', '').strip('"') not in ('24.04', '26.04'):
        raise RuntimeError('Supported hosts: Ubuntu 24.04 and 26.04.')
    if platform.machine() not in ('x86_64', 'aarch64') or not Path('/run/systemd/system').is_dir():
        raise RuntimeError('A systemd host with an amd64 or arm64 CPU is required.')


def install_packages(packages):
    env = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'}
    run(['apt-get', 'update'], env=env)
    run(['apt-get', 'install', '-y', '--no-install-recommends', *packages], env=env)


def build_binary(directory):
    if not (ROOT / 'server/go.mod').is_file():
        raise RuntimeError('Run install.sh from the source checkout, or supply --binary.')
    install_packages(['nodejs', 'npm', 'gcc', 'libc6-dev', 'libpam0g-dev'])
    source = directory / 'source'
    source.mkdir()
    for name in ('src', 'tests', 'server'):
        shutil.copytree(ROOT / name, source / name, ignore=shutil.ignore_patterns('node_modules', 'dist', 'bin', '.tools', '__pycache__'))
    for name in ('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts'):
        shutil.copy2(ROOT / name, source / name)
    with urllib.request.urlopen('https://go.dev/dl/?mode=json', timeout=30) as response:
        releases = json.load(response)
    arch = 'amd64' if platform.machine() == 'x86_64' else 'arm64'
    archive = next(file for release in releases if release['stable'] for file in release['files']
                   if file['os'] == 'linux' and file['arch'] == arch and file['kind'] == 'archive')
    archive_path = directory / 'go.tar.gz'
    with urllib.request.urlopen('https://go.dev/dl/' + archive['filename'], timeout=60) as response, archive_path.open('wb') as output:
        shutil.copyfileobj(response, output)
    if hashlib.sha256(archive_path.read_bytes()).hexdigest() != archive['sha256']:
        raise RuntimeError('The Go download checksum did not match.')
    with tarfile.open(archive_path) as bundle:
        bundle.extractall(directory, filter='data')
    env = {**os.environ, 'VITE_LUMIO_LIVE': '1', 'CGO_ENABLED': '1', 'GOTOOLCHAIN': 'local',
           'GOCACHE': str(source / '.tools/gocache'), 'GOMODCACHE': str(source / '.tools/gomodcache'),
           'GOPATH': str(source / '.tools/gopath')}
    run(['npm', 'ci', '--ignore-scripts'], cwd=source, env=env)
    run(['npm', 'run', 'build'], cwd=source, env=env)
    shutil.copytree(source / 'dist', source / 'server/internal/static/dist')
    binary = directory / 'lumiod'
    run([directory / 'go/bin/go', 'build', '-trimpath', '-tags', 'pam,webdist', '-o', binary, './cmd/lumiod'], cwd=source / 'server', env=env)
    return binary


def validate_binary(binary):
    info = json.loads(run([binary, 'version'], capture=True))
    if info.get('os') != 'linux' or not info.get('pam') or not info.get('web'):
        raise RuntimeError('The binary must be a Linux build with both PAM and the frontend embedded.')


def acme_command(config, args):
    command = [str(CERTBOT), 'certonly', '--non-interactive', '--agree-tos', '--cert-name', 'lumio',
               '--preferred-challenges', 'http', '--deploy-hook', '/usr/local/bin/lumioctl renew-certificate']
    command += ['--email', args.email] if args.email else ['--register-unsafely-without-email']
    command += ['--webroot', '--webroot-path', str(Path(args.webroot).resolve())] if args.webroot else ['--standalone']
    try:
        ipaddress.ip_address(config['host'])
        command += ['--ip-address', config['host'], '--required-profile', 'shortlived']
    except ValueError:
        command += ['--domains', config['host']]
    return command


def certificate_sources(config, args):
    if args.cert or args.key:
        if not args.cert or not args.key:
            raise ValueError('Supply both --cert and --key.')
        return str(Path(args.cert).resolve()), str(Path(args.key).resolve()), False
    if config.get('cert_source'):
        return config['cert_source'], config['key_source'], config['acme']
    if not args.accept_acme_terms:
        if not sys.stdin.isatty() or input('Accept the Let’s Encrypt subscriber agreement at https://letsencrypt.org/repository/? [yes/no] ').strip().lower() != 'yes':
            raise RuntimeError('HTTPS needs a certificate. Accept ACME terms explicitly, or supply --cert and --key.')
    try:
        address = ipaddress.ip_address(config['host'])
        if not address.is_global:
            raise ValueError('Automatic certificates require a public IP; use your own certificate for private/test hosts.')
    except ValueError as error:
        if 'public IP' in str(error):
            raise
    if not args.webroot and not available_port(80):
        raise RuntimeError('Port 80 is occupied. Use --webroot with your existing web server, or supply --cert and --key.')
    print('Certificate validation needs inbound TCP 80; allow it in the VPS/provider firewall.', flush=True)
    install_packages(['python3-venv'])
    run(['python3', '-m', 'venv', '/opt/lumio-certbot'])
    run(['/opt/lumio-certbot/bin/pip', 'install', 'certbot>=5.4,<6'])
    command = acme_command(config, args)
    hook = command.index('--deploy-hook')
    run(command[:hook] + command[hook + 2:])
    return '/etc/letsencrypt/live/lumio/fullchain.pem', '/etc/letsencrypt/live/lumio/privkey.pem', True


def validate_certificate(cert, key, host):
    ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER).load_cert_chain(cert, key)
    run(['openssl', 'x509', '-in', cert, '-noout', '-checkend', '86400'], capture=True)
    try:
        ipaddress.ip_address(host)
        flag = '-checkip'
    except ValueError:
        flag = '-checkhost'
    run(['openssl', 'x509', '-in', cert, '-noout', flag, host], capture=True)


def copy_certificate(config):
    validate_certificate(config['cert_source'], config['key_source'], config['host'])
    TLS.mkdir(parents=True, exist_ok=True)
    os.chmod(TLS, 0o750)
    os.chown(TLS, 0, grp.getgrnam('lumio-gw').gr_gid)
    generation = TLS / ('pair-' + secrets.token_hex(8))
    generation.mkdir(mode=0o750)
    os.chmod(generation, 0o750)
    os.chown(generation, 0, grp.getgrnam('lumio-gw').gr_gid)
    write(generation / 'cert.pem', Path(config['cert_source']).read_bytes(), 0o640, 'lumio-gw')
    write(generation / 'key.pem', Path(config['key_source']).read_bytes(), 0o640, 'lumio-gw')
    link = TLS / ('next-' + secrets.token_hex(8))
    link.symlink_to(generation.name)
    os.replace(link, TLS / 'current')
    pairs = sorted(TLS.glob('pair-*'), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in pairs[2:]:
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)


def provision_accounts(config):
    for group in ('lumio-gw', 'lumio-users', 'lumio-admin'):
        run(['groupadd', '--system', '--force', group])
    try:
        gateway = pwd.getpwnam('lumio-gw')
        if gateway.pw_uid == 0 or gateway.pw_gid != grp.getgrnam('lumio-gw').gr_gid:
            raise RuntimeError('The existing lumio-gw account has unexpected permissions.')
    except KeyError:
        run(['useradd', '--system', '--gid', 'lumio-gw', '--no-create-home', '--shell', '/usr/sbin/nologin', 'lumio-gw'])
    try:
        account = pwd.getpwnam(config['username'])
        if account.pw_uid == 0 or (config.get('uid') is not None and account.pw_uid != config['uid']):
            raise RuntimeError('The configured account identity changed or is root.')
    except KeyError:
        if not config['managed_user']:
            raise RuntimeError('The requested existing user does not exist.')
        run(['useradd', '--create-home', '--shell', '/bin/bash', config['username']])
    run(['usermod', '-aG', 'lumio-users,lumio-admin,systemd-journal', config['username']])
    config['uid'] = pwd.getpwnam(config['username']).pw_uid


def set_password(username):
    password = secrets.token_urlsafe(24)
    run(['chpasswd'], data=f'{username}:{password}\n', capture=True)
    return password


def units(config):
    prefix = '# SPDX-License-Identifier: AGPL-3.0-only\n'
    output = {}
    for service in SERVICES:
        role = service.removeprefix('lumiod-')
        after = 'network.target dbus.service polkit.service'
        if role == 'gateway':
            after += ' lumiod-sessiond.service lumiod-broker.service'
        options = ''
        extra = 'UMask=0027\n' if role == 'sessiond' else 'UMask=0077\n'
        if role == 'gateway':
            options = f" -addr :{config['port']} -tls-cert /etc/lumio/tls/current/cert.pem -tls-key /etc/lumio/tls/current/key.pem"
            extra += 'User=lumio-gw\nGroup=lumio-gw\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\nPrivateDevices=true\nCapabilityBoundingSet=\nExecReload=/bin/kill -HUP $MAINPID\n'
        output[service + '.service'] = prefix + f'''[Unit]
Description=Lumio OS {role}
After={after}

[Service]
Type=simple
ExecStart=/usr/local/lib/lumio/lumiod {role}{options}
Restart=on-failure
RestartSec=2
{extra}
[Install]
WantedBy=multi-user.target
'''
    output['lumio-cert-renew.service'] = prefix + '''[Unit]
Description=Renew Lumio HTTPS certificate
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/lumio-certbot/bin/certbot renew --cert-name lumio --quiet --deploy-hook "/usr/local/bin/lumioctl renew-certificate"
'''
    output['lumio-cert-renew.timer'] = prefix + '''[Unit]
Description=Check Lumio HTTPS certificate every hour
[Timer]
OnBootSec=5min
OnUnitActiveSec=1h
RandomizedDelaySec=5min
Persistent=true
[Install]
WantedBy=timers.target
'''
    return output


def request_local(config, path, body=None, headers=None, with_headers=False):
    context = ssl.create_default_context()
    context.load_verify_locations(str(TLS / 'current/cert.pem'))
    connection = http.client.HTTPSConnection(config['host'], config['port'], context=context, timeout=4)
    connection.sock = context.wrap_socket(socket.create_connection(('127.0.0.1', config['port']), timeout=4), server_hostname=config['host'])
    try:
        connection.request('POST' if body is not None else 'GET', path,
                           json.dumps(body) if body is not None else None,
                           {'Content-Type': 'application/json', **(headers or {})})
        response = connection.getresponse()
        data = response.read()
        if response.status != 200:
            raise RuntimeError(f'Local health check returned HTTP {response.status}.')
        payload = json.loads(data)
        return (payload, response.headers) if with_headers else payload
    finally:
        connection.close()


def health_check(config, password=None):
    for attempt in range(30):
        try:
            request_local(config, '/api/v1/meta/version')
            run(['systemctl', 'is-active', '--quiet', *SERVICES], capture=True)
            if password:
                _, headers = request_local(config, '/api/v1/auth/login',
                                           {'username': config['username'], 'password': password}, with_headers=True)
                cookies = SimpleCookie()
                for cookie in headers.get_all('Set-Cookie', []):
                    cookies.load(cookie)
                request_local(config, '/api/v1/system/identity', headers={
                    'Cookie': '; '.join(f'{name}={cookie.value}' for name, cookie in cookies.items())})
            return
        except (OSError, RuntimeError, http.client.HTTPException):
            if attempt == 29:
                raise RuntimeError('Startup/login verification failed. Check journalctl -u lumiod-gateway -u lumiod-sessiond -u lumiod-broker.')
            time.sleep(1)


def activate(config, password, files, previous):
    backups = {path: (path.read_bytes(), path.stat().st_mode & 0o777) if path.exists() else None for path in files}
    previous_tls = os.readlink(TLS / 'current') if (TLS / 'current').is_symlink() else None
    try:
        copy_certificate(config)
        for path, (content, mode) in files.items():
            write(path, content, mode)
        run(['systemctl', 'daemon-reload'])
        run(['systemctl', 'enable', *SERVICES])
        run(['systemctl', 'restart', *SERVICES])
        health_check(config, password)
        run(['systemctl', 'enable' if config['acme'] else 'disable', '--now', 'lumio-cert-renew.timer'])
        config['ready'] = True
        save_config(config)
    except Exception:
        if previous and previous.get('ready') and backups[LIB / 'lumiod']:
            for path, backup in backups.items():
                if backup is not None:
                    write(path, *backup)
                else:
                    path.unlink(missing_ok=True)
            if previous_tls:
                rollback = TLS / ('rollback-' + secrets.token_hex(8))
                rollback.symlink_to(previous_tls)
                os.replace(rollback, TLS / 'current')
            save_config(previous)
            run(['systemctl', 'daemon-reload'])
            run(['systemctl', 'restart', *SERVICES])
            run(['systemctl', 'enable' if previous['acme'] else 'disable', '--now', 'lumio-cert-renew.timer'])
        else:
            with contextlib.suppress(RuntimeError):
                run(['systemctl', 'stop', *SERVICES])
        raise


def install(args):
    policy = (ROOT / 'docker/os.lumio.policy').read_bytes()
    rules = (ROOT / 'deploy/os.lumio.rules').read_bytes()
    previous = load_config()
    if previous:
        config = dict(previous)
        for field in ('host', 'port'):
            if getattr(args, field) is not None and getattr(args, field) != config[field]:
                raise ValueError(f'An installation already exists; its {field} is preserved during upgrades.')
        if args.user and args.user != config['username']:
            raise ValueError('The existing login account is preserved during upgrades.')
    else:
        username = args.user or choose_username()
        if args.user and (not re.fullmatch(r'[a-z_][a-z0-9_-]{0,31}', username) or pwd.getpwnam(username).pw_uid == 0):
            raise ValueError('--user must name an existing non-root Linux user.')
        config = {'host': validate_host(args.host or public_host()), 'port': choose_port(args.port),
                  'username': username, 'managed_user': not bool(args.user), 'ready': False}
    install_packages(['ca-certificates', 'curl', 'libpam0g', 'libpam-modules', 'dbus', 'polkitd', 'openssl'])
    with tempfile.TemporaryDirectory(prefix='lumio-install-') as temporary:
        directory = Path(temporary)
        binary = Path(args.binary).resolve() if args.binary else build_binary(directory)
        validate_binary(binary)
        cert, key, acme = certificate_sources(config, args)
        validate_certificate(cert, key, config['host'])
        config.update(cert_source=cert, key_source=key, acme=acme)
        if not config['ready']:
            save_config(config)
        provision_accounts(config)
        if not config['ready']:
            save_config(config)
        password = set_password(config['username']) if config['managed_user'] and not config['ready'] else None
        LIB.mkdir(parents=True, exist_ok=True)
        os.chmod(LIB, 0o755)
        files = {
            LIB / 'lumiod': (binary.read_bytes(), 0o755),
            LIB / 'installer.py': (Path(__file__).read_bytes(), 0o644),
            Path('/usr/local/bin/lumioctl'): ('#!/bin/sh\n# SPDX-License-Identifier: AGPL-3.0-only\nexec /usr/bin/python3 /usr/local/lib/lumio/installer.py "$@"\n', 0o755),
            Path('/etc/pam.d/lumiod'): ('# SPDX-License-Identifier: AGPL-3.0-only\nauth required pam_succeed_if.so user ingroup lumio-users quiet\nauth required pam_unix.so\naccount required pam_unix.so\n', 0o644),
            Path('/usr/share/polkit-1/actions/os.lumio.policy'): (policy, 0o644),
            Path('/etc/polkit-1/rules.d/50-lumio.rules'): (rules, 0o644),
        }
        for name, content in units(config).items():
            files[Path('/etc/systemd/system') / name] = (content, 0o644)
        activate(config, password, files, previous)
    print('\nLumio OS installed successfully\n')
    show_status(config)
    print(f'Password:  {password}' if password else 'Password:  unchanged (use your existing password)')
    if password:
        print('Save this password; Lumio does not keep a plaintext copy.')
    print(f"\nAllow inbound TCP {config['port']} in the host and provider firewall.")
    if config['acme']:
        print('Keep TCP 80 reachable for automatic certificate renewal.')
    print('Reset password: sudo lumioctl reset-password')


def show_status(config):
    host = '[' + config['host'] + ']' if ':' in config['host'] else config['host']
    print(f"Address:   https://{host}:{config['port']}\nUsername:  {config['username']}")


def main(argv=None):
    parser = argparse.ArgumentParser(description='Install and manage Lumio OS on Ubuntu.')
    parser.add_argument('command', choices=('install', 'status', 'reset-password', 'renew-certificate'), nargs='?', default='install')
    parser.add_argument('--host', type=validate_host)
    parser.add_argument('--port', type=int)
    parser.add_argument('--user', help='Use an existing non-root Linux user without changing its password.')
    parser.add_argument('--binary', help='Use a prebuilt Linux binary with pam,webdist; otherwise build this checkout.')
    parser.add_argument('--cert', help='Existing PEM certificate chain; pair with --key.')
    parser.add_argument('--key', help='Existing PEM private key.')
    parser.add_argument('--webroot', help='Existing web server root for HTTP certificate validation on port 80.')
    parser.add_argument('--email', help='Email for the certificate authority account.')
    parser.add_argument('--accept-acme-terms', action='store_true', help='Accept the Let’s Encrypt subscriber agreement explicitly.')
    args = parser.parse_args(argv)
    require_host()
    os.umask(0o077)
    with open('/run/lock/lumio-install.lock', 'a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'install':
            install(args)
            return
        config = load_config()
        if not config:
            raise RuntimeError('Lumio is not installed.')
        if args.command == 'status':
            show_status(config)
        elif args.command == 'reset-password':
            if not config['managed_user']:
                raise RuntimeError('This is an existing Linux account. Use sudo passwd USER to manage its password.')
            password = set_password(config['username'])
            run(['systemctl', 'restart', 'lumiod-sessiond', 'lumiod-gateway'])
            health_check(config, password)
            show_status(config)
            print(f'Password:  {password}\nSave this password; it is shown only now.')
        elif args.command == 'renew-certificate':
            copy_certificate(config)
            run(['systemctl', 'reload', 'lumiod-gateway'])


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(f'Installation stopped: {error}', file=sys.stderr)
        sys.exit(1)
