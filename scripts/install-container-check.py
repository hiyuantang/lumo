# SPDX-License-Identifier: AGPL-3.0-only
import importlib.util
import json
from pathlib import Path
import re
import ssl
import subprocess

ROOT = Path('/opt/lumio-test')


def run(args):
    return subprocess.run(args, text=True, capture_output=True, check=True).stdout


def credentials(output):
    return re.search(r'^Username:  (.+)$', output, re.M)[1], re.search(r'^Password:  (.+)$', output, re.M)[1]


run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3', '-subj', '/CN=127.0.0.1',
     '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', '/tmp/lumio-test-key.pem', '-out', '/tmp/lumio-test-cert.pem'])
command = ['python3', str(ROOT / 'scripts/install.py'), '--host', '127.0.0.1', '--binary', str(ROOT / 'lumiod'),
           '--cert', '/tmp/lumio-test-cert.pem', '--key', '/tmp/lumio-test-key.pem']
installed = run(command)
username, password = credentials(installed)
config = json.loads(Path('/etc/lumio/install.json').read_text())
assert config['username'] == username and 20000 <= config['port'] < 60000
assert len(password) >= 32 and password not in Path('/etc/lumio/install.json').read_text()
assert Path('/etc/lumio/install.json').stat().st_mode & 0o777 == 0o600
assert Path('/etc/lumio/tls/current/key.pem').stat().st_mode & 0o777 == 0o640
assert 'sudo' not in run(['id', '-nG', username]).split()
assert 'lumio-admin' in run(['id', '-nG', username]).split()
print('PASS: fresh install generates a private, non-root login and random port')

spec = importlib.util.spec_from_file_location('installer', ROOT / 'scripts/install.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': password})
context = ssl.create_default_context(cafile='/tmp/lumio-test-cert.pem')
import urllib.request
with urllib.request.urlopen(f"https://127.0.0.1:{config['port']}/", context=context) as response:
    assert b'<div id="root">' in response.read()
request = urllib.request.Request(f"https://127.0.0.1:{config['port']}/api/v1/auth/login",
    data=json.dumps({'username': username, 'password': password}).encode(), headers={'Content-Type': 'application/json'})
with urllib.request.urlopen(request, context=context) as response:
    assert all('Secure' in cookie for cookie in response.headers.get_all('Set-Cookie'))
    assert 'max-age=' in response.headers['Strict-Transport-Security']
print('PASS: trusted local HTTPS serves the live UI and real PAM login with secure cookies')

upgraded = run(command)
assert 'Password:  unchanged' in upgraded and password not in upgraded
assert json.loads(Path('/etc/lumio/install.json').read_text()) == config
module.request_local(config, '/api/v1/auth/login', {'username': username, 'password': password})
print('PASS: upgrade preserves the port, account and password')

reset = run(['lumioctl', 'reset-password'])
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
     '-addext', 'subjectAltName=IP:127.0.0.1', '-keyout', '/tmp/lumio-test-key.pem', '-out', '/tmp/lumio-test-cert.pem'])
run(['lumioctl', 'renew-certificate'])
module.health_check(config, new_password)
logs = run(['journalctl', '--no-pager', '-u', 'lumiod-gateway', '-u', 'lumiod-sessiond', '-u', 'lumiod-broker'])
assert password not in logs and new_password not in logs
print('PASS: renewed TLS certificate loads without recording credentials in service logs')

result = subprocess.run([str(ROOT / 'lumiod'), 'gateway', '-addr', ':19090'], capture_output=True, text=True)
assert result.returncode != 0 and 'require HTTPS' in result.stderr
result = subprocess.run([str(ROOT / 'lumiod')], capture_output=True, text=True)
assert result.returncode != 0 and 'Usage:' in result.stderr
print('PASS: public plaintext and accidental unauthenticated startup are rejected')
