# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util
import json
import os
from pathlib import Path
import pwd
import re
import ssl
import subprocess

ROOT = Path('/opt/lumo-test')


def run(args):
    result = subprocess.run(args, text=True, capture_output=True)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed: {result.stderr.strip()}')
    return result.stdout


def credentials(output):
    return re.search(r'^Username:  (.+)$', output, re.M)[1], re.search(r'^Password:  (.+)$', output, re.M)[1]


run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3', '-subj', '/CN=127.0.0.1',
     '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', '/tmp/lumo-test-key.pem', '-out', '/tmp/lumo-test-cert.pem'])
command = ['python3', str(ROOT / 'scripts/install.py'), '--host', '127.0.0.1', '--binary', str(ROOT / 'lumod'),
           '--cert', '/tmp/lumo-test-cert.pem', '--key', '/tmp/lumo-test-key.pem']
installed = run(command)
username, password = credentials(installed)
config = json.loads(Path('/etc/lumo/install.json').read_text())
assert config['username'] == username and 20000 <= config['port'] < 60000
assert len(password) >= 32 and password not in Path('/etc/lumo/install.json').read_text()
assert Path('/etc/lumo/install.json').stat().st_mode & 0o777 == 0o600
assert Path('/etc/lumo/tls/current/key.pem').stat().st_mode & 0o777 == 0o640
assert 'sudo' not in run(['id', '-nG', username]).split()
assert 'lumo-admin' in run(['id', '-nG', username]).split()
print('PASS: fresh install generates a private, non-root login and random port')

spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': password})
context = ssl.create_default_context(cafile='/tmp/lumo-test-cert.pem')
import urllib.request
with urllib.request.urlopen(f"https://127.0.0.1:{config['port']}/", context=context) as response:
    assert b'<div id="root">' in response.read()
request = urllib.request.Request(f"https://127.0.0.1:{config['port']}/api/v1/auth/login",
    data=json.dumps({'username': username, 'password': password}).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, context=context) as response:
    assert all('Secure' in cookie for cookie in response.headers.get_all('Set-Cookie'))
    assert 'max-age=' in response.headers['Strict-Transport-Security']
print('PASS: trusted local HTTPS serves the live UI and real PAM login with secure cookies')

Path('/usr/local/bin/lumoctl').write_bytes(Path('/usr/local/bin/lumo').read_bytes())
Path('/usr/local/bin/lumo').unlink()
assert username in run(['lumoctl', 'status'])
upgraded = run(command)
assert 'Password:  unchanged' in upgraded and password not in upgraded
assert json.loads(Path('/etc/lumo/install.json').read_text()) == config
module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': password})
print('PASS: upgrade preserves the port, account and password')

assert run(['lumo', 'status']) == run(['lumoctl', 'status'])
assert 'usage: lumo ' in run(['lumo', '--help'])
print('PASS: lumo and the legacy lumoctl alias report the same installation')

reset = run(['lumo', 'reset-password'])
reset_user, new_password = credentials(reset)
assert reset_user == username and new_password != password
module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': new_password})
try:
    module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': password})
    raise AssertionError('Old password remained valid')
except RuntimeError:
    pass
print('PASS: password reset invalidates the old password and reopens authenticated access')

run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3', '-subj', '/CN=127.0.0.1',
     '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', '/tmp/lumo-test-key.pem', '-out', '/tmp/lumo-test-cert.pem'])
run(['lumo', 'renew-certificate'])
module.health_check(config, new_password)
logs = run(['journalctl', '--no-pager', '-u', 'lumod-gateway', '-u', 'lumod-sessiond', '-u', 'lumod-broker'])
assert password not in logs and new_password not in logs
print('PASS: renewed TLS certificate loads without recording credentials in service logs')

result = subprocess.run([str(ROOT / 'lumod'), 'gateway', '-addr', ':19090'], capture_output=True, text=True)
assert result.returncode != 0 and 'require HTTPS' in result.stderr
result = subprocess.run([str(ROOT / 'lumod')], capture_output=True, text=True)
assert result.returncode != 0 and 'Usage:' in result.stderr
print('PASS: public plaintext and accidental unauthenticated startup are rejected')

account = pwd.getpwnam(username)
personal = Path(account.pw_dir) / 'keep-after-uninstall.md'
personal.write_text('keep this user document')
os.chown(personal, account.pw_uid, account.pw_gid)
recovery = Path('/var/lib/lumo/rollback/files/keep-after-uninstall.conf')
recovery.parent.mkdir(parents=True, exist_ok=True)
recovery.write_text('keep this rollback record')
run(['lumo', 'uninstall', '--dry-run'])
assert Path('/etc/lumo/install.json').exists()
run(['systemctl', 'is-active', '--quiet', *module.SERVICES])
run(['lumo', 'uninstall', '--yes'])
assert not Path('/etc/lumo/install.json').exists()
assert not Path('/usr/local/bin/lumo').exists()
assert not Path('/usr/local/bin/lumoctl').exists()
assert not Path('/usr/local/lib/lumo').exists()
assert not Path('/etc/pam.d/lumod').exists()
assert not Path('/etc/polkit-1/rules.d/50-lumo.rules').exists()
assert personal.read_text() == 'keep this user document'
assert personal.stat().st_uid == account.pw_uid == pwd.getpwnam(username).pw_uid
assert recovery.read_text() == 'keep this rollback record'
assert Path('/tmp/lumo-test-cert.pem').exists() and Path('/tmp/lumo-test-key.pem').exists()
for unit in module.UNIT_NAMES:
    assert run(['systemctl', 'show', '--property=LoadState', '--value', unit]).strip() == 'not-found'
print('PASS: uninstall stops and disables all services while preserving Linux accounts, personal files and recovery records')

uninstall = ['python3', str(ROOT / 'scripts/install.py'), 'uninstall', '--yes']
run(uninstall)
run([*uninstall, '--purge'])
run([*uninstall, '--purge'])
assert not Path('/var/lib/lumo').exists()
assert personal.read_text() == 'keep this user document'
print('PASS: source fallback supports repeated uninstall and selective data purge')
