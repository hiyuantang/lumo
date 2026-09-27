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
CONFIG = Path('/etc/lumo/install.json')
LIB = Path('/usr/local/lib/lumo')
TLS = Path('/etc/lumo/tls')
CERTBOT = Path('/opt/lumo-certbot/bin/certbot')
ACME = Path('/etc/lumo/acme')
ACME_WORK = Path('/etc/lumo/acme-work')
ACME_LOGS = Path('/etc/lumo/acme-logs')
STATE = Path('/var/lib/lumo')
RUNTIME = Path('/run/lumo')
UNIT_DIR = Path('/etc/systemd/system')
CONTROL = Path('/usr/local/bin/lumo')
LEGACY_CONTROL = Path('/usr/local/bin/lumoctl')
PAM = Path('/etc/pam.d/lumod')
POLICY = Path('/usr/share/polkit-1/actions/os.lumo.policy')
RULES = Path('/etc/polkit-1/rules.d/50-lumo.rules')
LOCK = Path('/run/lock/lumo-install.lock')
PROCESS_CGROUP = Path('/proc/self/cgroup')
SERVICES = ['lumod-broker', 'lumod-sessiond', 'lumod-gateway']
UNIT_NAMES = [service + '.service' for service in SERVICES] + ['lumo-cert-renew.service', 'lumo-cert-renew.timer']


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
        username = 'lumo_' + secrets.token_hex(3)
        try:
            pwd.getpwnam(username)
        except KeyError:
            return username
    raise RuntimeError('Could not create a unique username.')


def require_host(installing=True):
    if sys.platform != 'linux' or os.geteuid() != 0:
        raise RuntimeError('Run with sudo on the Linux host where Lumo is installed.')
    if not Path('/run/systemd/system').is_dir():
        raise RuntimeError('A running systemd host is required.')
    if not installing:
        return
    release = dict(line.split('=', 1) for line in Path('/etc/os-release').read_text().splitlines() if '=' in line)
    if release.get('ID', '').strip('"') != 'ubuntu' or release.get('VERSION_ID', '').strip('"') not in ('24.04', '26.04'):
        raise RuntimeError('Supported hosts: Ubuntu 24.04 and 26.04.')
    if platform.machine() not in ('x86_64', 'aarch64'):
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
    for name in ('package.json', 'package-lock.json', 'index.html', 'tsconfig.json', 'vite.config.ts', 'playwright.config.ts', 'playwright.docker.config.ts'):
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
    env = {**os.environ, 'VITE_LUMO_LIVE': '1', 'CGO_ENABLED': '1', 'GOTOOLCHAIN': 'local',
           'GOCACHE': str(source / '.tools/gocache'), 'GOMODCACHE': str(source / '.tools/gomodcache'),
           'GOPATH': str(source / '.tools/gopath')}
    run(['npm', 'ci', '--ignore-scripts'], cwd=source, env=env)
    run(['npm', 'run', 'build'], cwd=source, env=env)
    shutil.copytree(source / 'dist', source / 'server/internal/static/dist')
    binary = directory / 'lumod'
    run([directory / 'go/bin/go', 'build', '-trimpath', '-tags', 'pam,webdist', '-o', binary, './cmd/lumod'], cwd=source / 'server', env=env)
    return binary


def validate_binary(binary):
    info = json.loads(run([binary, 'version'], capture=True))
    if info.get('os') != 'linux' or not info.get('pam') or not info.get('web'):
        raise RuntimeError('The binary must be a Linux build with both PAM and the frontend embedded.')


def acme_command(config, args):
    command = [str(CERTBOT), 'certonly', '--non-interactive', '--agree-tos', '--cert-name', 'lumo',
               '--preferred-challenges', 'http', '--deploy-hook', '/usr/local/bin/lumo renew-certificate']
    command += ['--email', args.email] if args.email else ['--register-unsafely-without-email']
    if config.get('acme_isolated'):
        command += acme_directories()
    command += ['--webroot', '--webroot-path', str(Path(args.webroot).resolve())] if args.webroot else ['--standalone']
    try:
        ipaddress.ip_address(config['host'])
        command += ['--ip-address', config['host'], '--required-profile', 'shortlived']
    except ValueError:
        command += ['--domains', config['host']]
    return command


def acme_directories():
    return ['--config-dir', str(ACME), '--work-dir', str(ACME_WORK), '--logs-dir', str(ACME_LOGS)]


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
    if not config.get('acme_isolated') and any(path.exists() or path.is_symlink() for path in (ACME, ACME_WORK, ACME_LOGS)):
        raise RuntimeError('Untracked Lumo certificate directories already exist; preserve or move them before installing.')
    config['acme_isolated'] = True
    config.setdefault('certbot_owned', not CERTBOT.parent.parent.exists())
    save_config(config)
    install_packages(['python3-venv'])
    run(['python3', '-m', 'venv', CERTBOT.parent.parent])
    run([CERTBOT.parent / 'pip', 'install', 'certbot>=5.4,<6'])
    command = acme_command(config, args)
    hook = command.index('--deploy-hook')
    run(command[:hook] + command[hook + 2:])
    return str(ACME / 'live/lumo/fullchain.pem'), str(ACME / 'live/lumo/privkey.pem'), True


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
    os.chown(TLS, 0, grp.getgrnam('lumo-gw').gr_gid)
    generation = TLS / ('pair-' + secrets.token_hex(8))
    generation.mkdir(mode=0o750)
    os.chmod(generation, 0o750)
    os.chown(generation, 0, grp.getgrnam('lumo-gw').gr_gid)
    write(generation / 'cert.pem', Path(config['cert_source']).read_bytes(), 0o640, 'lumo-gw')
    write(generation / 'key.pem', Path(config['key_source']).read_bytes(), 0o640, 'lumo-gw')
    link = TLS / ('next-' + secrets.token_hex(8))
    link.symlink_to(generation.name)
    os.replace(link, TLS / 'current')
    pairs = sorted(TLS.glob('pair-*'), key=lambda path: path.stat().st_mtime, reverse=True)
    for old in pairs[2:]:
        if old.is_dir() and not old.is_symlink():
            shutil.rmtree(old)


def provision_accounts(config):
    if config.get('ready') and 'added_groups' not in config:
        config['legacy_memberships'] = True
    config.setdefault('created_groups', {})
    for group in ('lumo-gw', 'lumo-users', 'lumo-admin'):
        try:
            grp.getgrnam(group)
        except KeyError:
            config['created_groups'][group] = None
            save_config(config)
        run(['groupadd', '--system', '--force', group])
        if group in config['created_groups'] and config['created_groups'][group] is None:
            config['created_groups'][group] = grp.getgrnam(group).gr_gid
            save_config(config)
    try:
        gateway = pwd.getpwnam('lumo-gw')
        if gateway.pw_uid == 0 or gateway.pw_gid != grp.getgrnam('lumo-gw').gr_gid:
            raise RuntimeError('The existing lumo-gw account has unexpected permissions.')
    except KeyError:
        run(['useradd', '--system', '--gid', 'lumo-gw', '--no-create-home', '--shell', '/usr/sbin/nologin', 'lumo-gw'])
    try:
        account = pwd.getpwnam(config['username'])
        if account.pw_uid == 0 or (config.get('uid') is not None and account.pw_uid != config['uid']):
            raise RuntimeError('The configured account identity changed or is root.')
    except KeyError:
        if not config['managed_user']:
            raise RuntimeError('The requested existing user does not exist.')
        run(['useradd', '--create-home', '--shell', '/bin/bash', config['username']])
    account = pwd.getpwnam(config['username'])
    config['uid'] = account.pw_uid
    current_groups = os.getgrouplist(config['username'], account.pw_gid)
    additions = config.setdefault('added_groups', {})
    for name in ('lumo-users', 'lumo-admin', 'systemd-journal'):
        group = grp.getgrnam(name)
        if group.gr_gid not in current_groups:
            additions[name] = group.gr_gid
    save_config(config)
    run(['usermod', '-aG', 'lumo-users,lumo-admin,systemd-journal', config['username']])


def set_password(username):
    password = secrets.token_urlsafe(24)
    run(['chpasswd'], data=f'{username}:{password}\n', capture=True)
    return password


def units(config):
    prefix = '# SPDX-License-Identifier: AGPL-3.0-only\n'
    output = {}
    for service in SERVICES:
        role = service.removeprefix('lumod-')
        after = 'network.target dbus.service polkit.service'
        if role == 'gateway':
            after += ' lumod-sessiond.service lumod-broker.service'
        options = ''
        extra = 'UMask=0027\n' if role == 'sessiond' else 'UMask=0077\n'
        if role == 'gateway':
            options = f" -addr :{config['port']} -tls-cert /etc/lumo/tls/current/cert.pem -tls-key /etc/lumo/tls/current/key.pem"
            extra += 'User=lumo-gw\nGroup=lumo-gw\nNoNewPrivileges=true\nProtectSystem=strict\nProtectHome=true\nPrivateTmp=true\nPrivateDevices=true\nCapabilityBoundingSet=\nExecReload=/bin/kill -HUP $MAINPID\n'
        output[service + '.service'] = prefix + f'''[Unit]
Description=Lumo {role}
After={after}

[Service]
Type=simple
ExecStart=/usr/local/lib/lumo/lumod {role}{options}
Restart=on-failure
RestartSec=2
{extra}
[Install]
WantedBy=multi-user.target
'''
    renewal_paths = ' ' + ' '.join(acme_directories()) if config.get('acme_isolated') else ''
    output['lumo-cert-renew.service'] = prefix + f'''[Unit]
Description=Renew Lumo HTTPS certificate
After=network-online.target
[Service]
Type=oneshot
ExecStart=/opt/lumo-certbot/bin/certbot renew{renewal_paths} --cert-name lumo --quiet --deploy-hook "/usr/local/bin/lumo renew-certificate"
'''
    output['lumo-cert-renew.timer'] = prefix + '''[Unit]
Description=Check Lumo HTTPS certificate every hour
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
                raise RuntimeError('Startup/login verification failed. Check journalctl -u lumod-gateway -u lumod-sessiond -u lumod-broker.')
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
        run(['systemctl', 'enable' if config['acme'] else 'disable', '--now', 'lumo-cert-renew.timer'])
        config['ready'] = True
        save_config(config)
    except Exception:
        if previous and previous.get('ready') and backups[LIB / 'lumod']:
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
            run(['systemctl', 'enable' if previous['acme'] else 'disable', '--now', 'lumo-cert-renew.timer'])
        else:
            with contextlib.suppress(RuntimeError):
                run(['systemctl', 'stop', *SERVICES])
        raise


def install(args):
    policy = (ROOT / 'docker/os.lumo.policy').read_bytes()
    rules = (ROOT / 'deploy/os.lumo.rules').read_bytes()
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
        save_config(config)
    install_packages(['ca-certificates', 'curl', 'libpam0g', 'libpam-modules', 'dbus', 'polkitd', 'openssl'])
    with tempfile.TemporaryDirectory(prefix='lumo-install-') as temporary:
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
            LIB / 'lumod': (binary.read_bytes(), 0o755),
            LIB / 'installer.py': (Path(__file__).read_bytes(), 0o644),
            CONTROL: ('#!/bin/sh\n# SPDX-License-Identifier: AGPL-3.0-only\nexec /usr/bin/python3 /usr/local/lib/lumo/installer.py "$@"\n', 0o755),
            LEGACY_CONTROL: ('#!/bin/sh\n# SPDX-License-Identifier: AGPL-3.0-only\nexec /usr/local/bin/lumo "$@"\n', 0o755),
            PAM: ('# SPDX-License-Identifier: AGPL-3.0-only\nauth required pam_succeed_if.so user ingroup lumo-users quiet\nauth required pam_unix.so\naccount required pam_unix.so\n', 0o644),
            POLICY: (policy, 0o644),
            RULES: (rules, 0o644),
        }
        for name, content in units(config).items():
            files[UNIT_DIR / name] = (content, 0o644)
        activate(config, password, files, previous)
    print('\nLumo installed successfully\n')
    show_status(config)
    print(f'Password:  {password}' if password else 'Password:  unchanged (use your existing password)')
    if password:
        print('Save this password; Lumo does not keep a plaintext copy.')
    print(f"\nAllow inbound TCP {config['port']} in the host and provider firewall.")
    if config['acme']:
        print('Keep TCP 80 reachable for automatic certificate renewal.')
    print('Reset password: sudo lumo reset-password')
    print('Uninstall: sudo lumo uninstall (keeps Linux accounts and files)')


def show_status(config):
    host = '[' + config['host'] + ']' if ':' in config['host'] else config['host']
    print(f"Address:   https://{host}:{config['port']}\nUsername:  {config['username']}")


def uninstall_paths(config, purge):
    files = [PAM, POLICY, RULES, *[UNIT_DIR / name for name in UNIT_NAMES]]
    trees = [RUNTIME, TLS, *[UNIT_DIR / (name + '.d') for name in UNIT_NAMES]]
    if config.get('acme_isolated'):
        trees += [ACME, ACME_WORK, ACME_LOGS]
    if config.get('certbot_owned'):
        trees.append(CERTBOT.parent.parent)
    if purge:
        trees.append(STATE)
    files += [LIB / 'lumod', LEGACY_CONTROL, CONTROL, LIB / 'installer.py', CONFIG]
    return files, trees


def check_cleanup_paths(files, trees, config):
    if set(config.get('added_groups', {})) - {'lumo-users', 'lumo-admin', 'systemd-journal'}:
        raise RuntimeError('Unexpected group in the installation record.')
    if set(config.get('created_groups', {})) - {'lumo-users', 'lumo-admin', 'lumo-gw'}:
        raise RuntimeError('Unexpected group in the installation record.')
    for path in [*files, *trees]:
        for parent in path.parents:
            if parent.is_symlink():
                raise RuntimeError(f'Refusing to remove files through a symlink directory: {parent}')
        if path in files and path.is_dir() and not path.is_symlink():
            raise RuntimeError(f'Expected an installed file, found a directory: {path}')
    for path in trees:
        if path.is_symlink():
            continue
        for directory, children, _ in os.walk(path, followlinks=False):
            for candidate in [Path(directory), *[Path(directory) / child for child in children]]:
                if not candidate.is_symlink() and os.path.ismount(candidate):
                    raise RuntimeError(f'Unmount this directory before uninstalling: {candidate}')
    if not config.get('acme'):
        for name in ('cert_source', 'key_source'):
            if not config.get(name):
                continue
            source = Path(config[name]).resolve()
            if any(source == path.resolve() or path.resolve() in source.parents for path in [*files, *trees, STATE]):
                raise RuntimeError(f'Move your supplied certificate outside Lumo directories before uninstalling: {source}')
    if config.get('added_groups'):
        try:
            account = pwd.getpwnam(config['username'])
        except KeyError:
            account = None
        if account is not None and (account.pw_uid == 0 or account.pw_uid != config.get('uid')):
            raise RuntimeError('The login account identity changed; uninstall stopped without changing the account.')


def remove_tree(path):
    if path.is_symlink():
        path.unlink()
    elif path.exists():
        shutil.rmtree(path)


def stop_units():
    order = ['lumo-cert-renew.timer', 'lumo-cert-renew.service',
             'lumod-gateway.service', 'lumod-sessiond.service', 'lumod-broker.service']
    for unit in order:
        state = run(['systemctl', 'show', '--property=LoadState', '--value', unit], capture=True).strip()
        if state == 'not-found':
            continue
        run(['systemctl', 'stop', unit])
        if unit != 'lumo-cert-renew.service':
            run(['systemctl', 'disable', unit])
        active = run(['systemctl', 'show', '--property=ActiveState', '--value', unit], capture=True).strip()
        if active == 'failed':
            run(['systemctl', 'reset-failed', unit])


def restore_memberships(config):
    additions = config.get('added_groups', {})
    if additions:
        try:
            account = pwd.getpwnam(config['username'])
        except KeyError:
            account = None
        if account is not None and (account.pw_uid == 0 or account.pw_uid != config.get('uid')):
            raise RuntimeError('The login account identity changed; group memberships were left untouched.')
        if account is not None:
            for name, gid in additions.items():
                if name not in ('lumo-users', 'lumo-admin', 'systemd-journal'):
                    raise RuntimeError('Unexpected group in the installation record.')
                try:
                    group = grp.getgrnam(name)
                except KeyError:
                    continue
                if group.gr_gid != gid:
                    print(f'Kept changed group identity: {name}')
                elif config['username'] in group.gr_mem:
                    run(['gpasswd', '--delete', config['username'], name], capture=True)
    for name, gid in config.get('created_groups', {}).items():
        if name not in ('lumo-gw', 'lumo-users', 'lumo-admin'):
            raise RuntimeError('Unexpected group in the installation record.')
        try:
            group = grp.getgrnam(name)
        except KeyError:
            continue
        if gid == group.gr_gid and not group.gr_mem and not any(user.pw_gid == gid for user in pwd.getpwall()):
            run(['groupdel', name], capture=True)


def uninstall(config, *, purge=False, yes=False, dry_run=False):
    files, trees = uninstall_paths(config, purge)
    present = any(path.exists() or path.is_symlink() for path in [*files, *trees])
    if not present:
        print('Lumo is already uninstalled.')
        if STATE.exists():
            print(f'Recovery records remain in {STATE}; use the source installer with uninstall --purge to remove them.')
        return
    check_cleanup_paths(files, trees, config)
    if not dry_run and PROCESS_CGROUP.exists() and re.search(r'/lumod-sessiond\.service(?:/|$)', PROCESS_CGROUP.read_text(), re.M):
        raise RuntimeError('Run uninstall over SSH or the VPS console; stopping Lumo would terminate this terminal and interrupt removal.')
    print('Uninstall Lumo:')
    print('  Stop and disable the web service, user sessions, broker and certificate renewal.')
    print('  Remove Lumo program files, startup units, PAM/polkit rules and managed HTTPS files.')
    print('  Keep Linux accounts, home folders, shared OS packages, external certificates and firewall settings.')
    print(f'  {"PERMANENTLY DELETE audit logs and rollback backups in" if purge else "Keep audit logs and rollback backups in"} {STATE}.')
    if dry_run:
        for path in files + trees:
            if path.exists() or path.is_symlink():
                print(f'  Remove: {path}')
        print('Preview only; no changes made.')
        return
    if not yes:
        if not sys.stdin.isatty():
            raise RuntimeError('Uninstall needs confirmation. Review --dry-run, then pass --yes for unattended removal.')
        confirmation = 'purge' if purge else 'uninstall'
        if input(f'Type {confirmation} to continue: ').strip() != confirmation:
            print('Uninstall cancelled; no changes made.')
            return
    stop_units()
    final_files = [LIB / 'lumod', LEGACY_CONTROL, CONTROL, LIB / 'installer.py', CONFIG]
    for path in files:
        if path not in final_files:
            path.unlink(missing_ok=True)
    for name in UNIT_NAMES:
        remove_tree(UNIT_DIR / (name + '.d'))
    run(['systemctl', 'daemon-reload'])
    restore_memberships(config)
    for path in trees:
        remove_tree(path)
    for path in final_files:
        path.unlink(missing_ok=True)
    for directory in (LIB, CONFIG.parent):
        if directory.is_dir() and not any(directory.iterdir()):
            directory.rmdir()
    print('\nLumo uninstalled. Linux accounts and personal files were preserved.')
    if not purge and STATE.exists():
        print(f'Kept recovery records: {STATE}')
    if config.get('username'):
        print(f"Kept Linux login: {config['username']} (existing SSH access is unchanged).")
    if config.get('legacy_memberships') or (config and 'added_groups' not in config):
        print('Older installation: pre-existing group memberships were kept because their original state was not recorded.')
    if config.get('acme') and not config.get('acme_isolated'):
        print(f"Kept externally stored certificate: {config.get('cert_source', '/etc/letsencrypt/live/lumo')}")
    if CERTBOT.parent.parent.exists():
        print(f'Kept pre-existing certificate tooling: {CERTBOT.parent.parent}')
    for directory in (LIB, CONFIG.parent):
        if directory.exists():
            print(f'Kept additional files in: {directory}')
    if config.get('port'):
        print(f"You can now close TCP {config['port']} in the host/provider firewall. Keep TCP 80 if another service uses it.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog='lumo', description='Install and manage Lumo on Ubuntu.')
    parser.add_argument('command', choices=('install', 'uninstall', 'status', 'reset-password', 'renew-certificate'), nargs='?', default='install')
    parser.add_argument('--host', type=validate_host)
    parser.add_argument('--port', type=int)
    parser.add_argument('--user', help='Use an existing non-root Linux user without changing its password.')
    parser.add_argument('--binary', help='Use a prebuilt Linux binary with pam,webdist; otherwise build this checkout.')
    parser.add_argument('--cert', help='Existing PEM certificate chain; pair with --key.')
    parser.add_argument('--key', help='Existing PEM private key.')
    parser.add_argument('--webroot', help='Existing web server root for HTTP certificate validation on port 80.')
    parser.add_argument('--email', help='Email for the certificate authority account.')
    parser.add_argument('--accept-acme-terms', action='store_true', help='Accept the Let’s Encrypt subscriber agreement explicitly.')
    parser.add_argument('--purge', action='store_true', help='With uninstall, also delete Lumo audit logs and rollback backups. Never deletes Linux accounts or personal files.')
    parser.add_argument('--yes', action='store_true', help='Confirm uninstall without an interactive prompt.')
    parser.add_argument('--dry-run', action='store_true', help='Preview uninstall without changing files or services.')
    args = parser.parse_args(argv)
    if args.command != 'uninstall' and (args.purge or args.yes or args.dry_run):
        parser.error('--purge, --yes and --dry-run apply only to uninstall.')
    if args.command != 'install' and (args.accept_acme_terms or any(
            getattr(args, name) is not None for name in ('host', 'port', 'user', 'binary', 'cert', 'key', 'webroot', 'email'))):
        parser.error('Host, account, binary and certificate options apply only to install.')
    require_host(installing=args.command == 'install')
    if args.command == 'uninstall' and args.dry_run:
        uninstall(load_config() or {}, purge=args.purge, dry_run=True)
        return
    os.umask(0o077)
    with LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if args.command == 'install':
            install(args)
            return
        if args.command == 'uninstall':
            uninstall(load_config() or {}, purge=args.purge, yes=args.yes)
            return
        config = load_config()
        if not config:
            raise RuntimeError('Lumo is not installed.')
        if args.command == 'status':
            show_status(config)
        elif args.command == 'reset-password':
            if not config['managed_user']:
                raise RuntimeError('This is an existing Linux account. Use sudo passwd USER to manage its password.')
            password = set_password(config['username'])
            run(['systemctl', 'restart', 'lumod-sessiond', 'lumod-gateway'])
            health_check(config, password)
            show_status(config)
            print(f'Password:  {password}\nSave this password; it is shown only now.')
        elif args.command == 'renew-certificate':
            copy_certificate(config)
            run(['systemctl', 'reload', 'lumod-gateway'])


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, KeyError, OSError) as error:
        print(f'Installation stopped: {error}', file=sys.stderr)
        sys.exit(1)
