# SPDX-License-Identifier: AGPL-3.0-only
import contextlib
import importlib.util
import io
import os
from pathlib import Path
import pwd

if not Path('/.dockerenv').exists() or os.geteuid() != 0:
    raise SystemExit('Run only inside the disposable installer test container.')

spec = importlib.util.spec_from_file_location('installer', Path(__file__).with_name('install.py'))
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)
os.umask(0o077)
username = installer.choose_username()
installer.run(['useradd', '--create-home', '--shell', '/bin/bash', username])
installer.run(['usermod', '-aG', 'systemd-journal', username])
config = {'username': username, 'managed_user': False, 'ready': False, 'host': '127.0.0.1', 'port': 45678,
          'acme': True, 'acme_isolated': True, 'certbot_owned': True}
installer.provision_accounts(config)
assert set(config['added_groups']) == {'lumo-users', 'lumo-admin'}
config['ready'] = True
installer.provision_accounts(config)
assert set(config['added_groups']) == {'lumo-users', 'lumo-admin'}
account = pwd.getpwnam(username)
personal = Path(account.pw_dir) / 'notes.md'
external_cert = Path('/etc/letsencrypt/live/unrelated/cert.pem')
audit = installer.STATE / 'audit.db'
rollback = installer.STATE / 'rollback/files/example.conf'
for path in (personal, external_cert, audit, rollback):
    installer.write(path, 'keep this content')
os.chown(personal, account.pw_uid, account.pw_gid)
files, trees = installer.uninstall_paths(config, False)
for path in files:
    installer.write(path, 'installer-owned file')
for path in trees:
    installer.write(path / 'fixture', 'installer-owned directory')
installer.save_config(config)
real_run = installer.run
service_calls = []


def contained_run(args, **kwargs):
    if args[0] == 'systemctl':
        service_calls.append(args)
        if args[1] == 'show':
            return 'loaded\n' if (installer.UNIT_DIR / args[-1]).exists() else 'not-found\n'
        return ''
    return real_run(args, **kwargs)


installer.run = contained_run
with contextlib.redirect_stdout(io.StringIO()):
    installer.uninstall(config, dry_run=True)
assert not service_calls
assert installer.CONFIG.exists()
with contextlib.redirect_stdout(io.StringIO()):
    installer.uninstall(config, yes=True)
assert not any(path.exists() or path.is_symlink() for path in files + trees)
assert account.pw_uid == pwd.getpwnam(username).pw_uid
assert personal.read_text() == 'keep this content' and personal.stat().st_uid == account.pw_uid
groups = real_run(['id', '-nG', username], capture=True).split()
assert 'systemd-journal' in groups and 'lumo-users' not in groups and 'lumo-admin' not in groups
assert external_cert.read_text() == audit.read_text() == rollback.read_text() == 'keep this content'
assert pwd.getpwnam('lumo-gw').pw_uid != 0
print('PASS: uninstall removes program/configuration files and restores real Linux group memberships')
print('PASS: Linux accounts, personal files, prior journal access and external certificates remain')
with contextlib.redirect_stdout(io.StringIO()):
    installer.uninstall({}, yes=True)
    installer.uninstall({}, purge=True, yes=True)
    installer.uninstall({}, purge=True, yes=True)
assert not installer.STATE.exists()
assert personal.read_text() == external_cert.read_text() == 'keep this content'
print('PASS: repeated uninstall and optional purge are safe for personal files')
print('Service manager calls were simulated; systemd boot and service shutdown were not tested.')
