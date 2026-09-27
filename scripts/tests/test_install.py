# SPDX-License-Identifier: AGPL-3.0-only
import argparse
import importlib.util
import os
from pathlib import Path
import socket
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('installer', Path(__file__).resolve().parents[1] / 'install.py')
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallerTests(unittest.TestCase):
    def test_host_validation_rejects_urls_and_shell_input(self):
        for host in ('https://example.com', 'example.com:8080', '-bad.example.com', 'example.com\nUser=root', 'x;touch /tmp/test'):
            with self.assertRaises(ValueError):
                installer.validate_host(host)
        self.assertEqual(installer.validate_host('[2001:db8::1]'), '2001:db8::1')
        self.assertEqual(installer.validate_host('Desktop.Example.COM'), 'desktop.example.com')

    def test_port_collision_is_rejected(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            with self.assertRaises(ValueError):
                installer.choose_port(listener.getsockname()[1])
        for port in (0, 80, 65536):
            with self.assertRaises(ValueError):
                installer.choose_port(port)

    def test_username_retries_existing_accounts(self):
        with patch.object(installer.secrets, 'token_hex', side_effect=['aaaaaa', 'bbbbbb']), \
             patch.object(installer.pwd, 'getpwnam', side_effect=[object(), KeyError()]):
            self.assertEqual(installer.choose_username(), 'lumo_bbbbbb')

    def test_ip_certificates_use_required_short_profile_and_renewal_hook(self):
        args = argparse.Namespace(email=None, webroot=None)
        command = installer.acme_command({'host': '203.0.113.8'}, args)
        self.assertIn('--ip-address', command)
        self.assertEqual(command[command.index('--required-profile') + 1], 'shortlived')
        self.assertIn('--standalone', command)
        self.assertIn('/usr/local/bin/lumo renew-certificate', command)
        args.webroot = '/srv/a path'
        command = installer.acme_command({'host': 'desktop.example.com'}, args)
        self.assertIn('--domains', command)
        self.assertNotIn('--ip-address', command)
        self.assertIn('/srv/a path', command)

    def test_production_units_use_tls_and_unprivileged_gateway(self):
        units = installer.units({'port': 48123})
        gateway = units['lumod-gateway.service']
        self.assertIn('User=lumo-gw', gateway)
        self.assertIn('-addr :48123 -tls-cert', gateway)
        self.assertNotIn('-insecure', gateway)
        self.assertIn('ExecReload=/bin/kill -HUP $MAINPID', gateway)
        self.assertIn('OnUnitActiveSec=1h', units['lumo-cert-renew.timer'])
        self.assertIn('/usr/local/bin/lumo renew-certificate', units['lumo-cert-renew.service'])
        after = units['lumod-sessiond.service'].split('After=', 1)[1].splitlines()[0]
        self.assertNotIn('lumod-sessiond.service', after)
        self.assertIn('UMask=0027', units['lumod-sessiond.service'])

    def test_certificate_issuance_and_renewal_share_private_directories(self):
        config = {'host': 'desktop.example.com', 'port': 48123, 'acme_isolated': True}
        args = argparse.Namespace(email=None, webroot=None)
        command = installer.acme_command(config, args)
        renewal = installer.units(config)['lumo-cert-renew.service']
        for flag, path in (('--config-dir', installer.ACME), ('--work-dir', installer.ACME_WORK), ('--logs-dir', installer.ACME_LOGS)):
            self.assertEqual(command[command.index(flag) + 1], str(path))
            self.assertIn(f'{flag} {path}', renewal)

    def test_failed_certificate_setup_records_owned_resources_for_uninstall(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {'host': '8.8.8.8', 'ready': False}
            args = argparse.Namespace(cert=None, key=None, accept_acme_terms=True, webroot=None)
            with patch.object(installer, 'CONFIG', root / 'etc/install.json'), \
                 patch.object(installer, 'ACME', root / 'etc/acme'), \
                 patch.object(installer, 'ACME_WORK', root / 'etc/acme-work'), \
                 patch.object(installer, 'ACME_LOGS', root / 'etc/acme-logs'), \
                 patch.object(installer, 'CERTBOT', root / 'certbot/bin/certbot'), \
                 patch.object(installer, 'available_port', return_value=True), \
                 patch.object(installer, 'install_packages', side_effect=RuntimeError('download failed')):
                with self.assertRaisesRegex(RuntimeError, 'download failed'):
                    installer.certificate_sources(config, args)
                saved = installer.load_config()
                self.assertTrue(saved['acme_isolated'])
                self.assertTrue(saved['certbot_owned'])
                self.assertFalse(saved['ready'])

    def test_missing_pam_or_ui_is_rejected_before_install(self):
        with patch.object(installer, 'run', return_value='{"os":"linux","pam":false,"web":true}'):
            with self.assertRaises(RuntimeError):
                installer.validate_binary('/tmp/lumod')

    def test_atomic_config_is_private_and_survives_rewrite(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(installer, 'CONFIG', Path(directory) / 'etc/lumo/install.json'):
            data = {'host': '203.0.113.8', 'port': 48123, 'username': 'lumo_123456'}
            installer.save_config(data)
            installer.save_config({**data, 'ready': True})
            self.assertEqual(installer.CONFIG.stat().st_mode & 0o777, 0o600)
            self.assertEqual(installer.load_config(), {**data, 'ready': True})

    def test_failed_upgrade_restores_binary_config_certificate_and_timer(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            library, tls = root / 'lib', root / 'tls'
            library.mkdir()
            tls.mkdir()
            (tls / 'pair-old').mkdir()
            (tls / 'current').symlink_to('pair-old')
            binary = library / 'lumod'
            installer.write(binary, 'working binary', 0o755)
            control = root / 'bin/lumo'
            legacy_control = root / 'bin/lumoctl'
            installer.write(legacy_control, 'working legacy command', 0o755)
            new_unit = root / 'new.service'
            previous = {'ready': True, 'acme': False, 'host': 'example.com', 'port': 45678}
            updated = {**previous, 'acme': True, 'cert_source': '/new/cert'}

            def replace_certificate(config):
                (tls / 'current').unlink()
                (tls / 'current').symlink_to('pair-new')

            with patch.object(installer, 'LIB', library), patch.object(installer, 'TLS', tls), \
                 patch.object(installer, 'CONFIG', root / 'etc/install.json'), \
                 patch.object(installer, 'run') as run, \
                 patch.object(installer, 'copy_certificate', side_effect=replace_certificate), \
                 patch.object(installer, 'health_check', side_effect=RuntimeError('startup failed')):
                installer.save_config(previous)
                with self.assertRaisesRegex(RuntimeError, 'startup failed'):
                    installer.activate(updated, None, {
                        binary: ('broken binary', 0o755), new_unit: ('new unit', 0o644),
                        control: ('new command', 0o755), legacy_control: ('new alias', 0o755),
                    }, previous)
                self.assertEqual(binary.read_text(), 'working binary')
                self.assertEqual(binary.stat().st_mode & 0o777, 0o755)
                self.assertFalse(new_unit.exists())
                self.assertFalse(control.exists())
                self.assertEqual(legacy_control.read_text(), 'working legacy command')
                self.assertEqual(legacy_control.stat().st_mode & 0o777, 0o755)
                self.assertEqual(installer.load_config(), previous)
                self.assertEqual(os.readlink(tls / 'current'), 'pair-old')
                run.assert_any_call(['systemctl', 'restart', *installer.SERVICES])
                run.assert_any_call(['systemctl', 'disable', '--now', 'lumo-cert-renew.timer'])

    def test_failed_first_install_stays_pending_and_stops_services(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = {'ready': False, 'acme': False}
            with patch.object(installer, 'LIB', root), patch.object(installer, 'TLS', root / 'tls'), \
                 patch.object(installer, 'run') as run, patch.object(installer, 'copy_certificate'), \
                 patch.object(installer, 'save_config') as save, \
                 patch.object(installer, 'health_check', side_effect=RuntimeError('login failed')):
                with self.assertRaisesRegex(RuntimeError, 'login failed'):
                    installer.activate(config, 'temporary-test-password', {root / 'lumod': ('binary', 0o755)}, None)
                self.assertFalse(config['ready'])
                save.assert_not_called()
                run.assert_any_call(['systemctl', 'stop', *installer.SERVICES])


if __name__ == '__main__':
    unittest.main()
