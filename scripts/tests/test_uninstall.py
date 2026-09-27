# SPDX-License-Identifier: AGPL-3.0-only
import contextlib
import io
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from test_install import installer


class UninstallTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        for name in ('CONFIG', 'LIB', 'TLS', 'CERTBOT', 'ACME', 'ACME_WORK', 'ACME_LOGS',
                     'STATE', 'RUNTIME', 'UNIT_DIR', 'CONTROL', 'LEGACY_CONTROL', 'PAM', 'POLICY', 'RULES', 'LOCK', 'PROCESS_CGROUP'):
            original = getattr(installer, name)
            self.enterContext(patch.object(installer, name, self.root / str(original).lstrip('/')))
        self.output = self.enterContext(contextlib.redirect_stdout(io.StringIO()))
        self.config = {'username': 'lumo_test', 'uid': 1234, 'port': 45678, 'managed_user': True,
                       'ready': True, 'acme': True, 'acme_isolated': True, 'certbot_owned': True,
                       'added_groups': {}, 'created_groups': {}}
        files, trees = installer.uninstall_paths(self.config, False)
        for path in files:
            installer.write(path, 'installed file')
        for path in trees:
            installer.write(path / 'fixture', 'managed file')
        installer.save_config(self.config)
        self.personal = self.root / 'home/lumo_test/notes.md'
        self.external_cert = self.root / 'etc/letsencrypt/live/other/cert.pem'
        self.audit = installer.STATE / 'audit.db'
        self.rollback = installer.STATE / 'rollback/files/saved-config'
        for path in (self.personal, self.external_cert, self.audit, self.rollback):
            installer.write(path, 'preserve this')
        installer.LOCK.parent.mkdir(parents=True, exist_ok=True)

        def command(args, **kwargs):
            if args[:2] == ['systemctl', 'show']:
                return 'loaded\n' if (installer.UNIT_DIR / args[-1]).exists() else 'not-found\n'
            return ''

        self.run = self.enterContext(patch.object(installer, 'run', side_effect=command))

    def assert_personal_files_preserved(self):
        self.assertEqual(self.personal.read_text(), 'preserve this')
        self.assertEqual(self.external_cert.read_text(), 'preserve this')
        self.assertFalse(any(c.args[0][0] in ('userdel', 'deluser', 'apt-get') for c in self.run.call_args_list))

    def test_safe_uninstall_removes_software_and_keeps_recovery_and_personal_files(self):
        installer.uninstall(self.config, yes=True)
        for path in (installer.CONFIG, installer.CONTROL, installer.LEGACY_CONTROL, installer.LIB, installer.TLS,
                     installer.PAM, installer.POLICY, installer.RULES, installer.RUNTIME,
                     installer.ACME, installer.ACME_WORK, installer.ACME_LOGS, installer.CERTBOT.parent.parent):
            self.assertFalse(path.exists(), str(path))
        for name in installer.UNIT_NAMES:
            self.assertFalse((installer.UNIT_DIR / name).exists())
            self.assertFalse((installer.UNIT_DIR / (name + '.d')).exists())
        self.assertEqual(self.audit.read_text(), 'preserve this')
        self.assertEqual(self.rollback.read_text(), 'preserve this')
        self.assert_personal_files_preserved()
        self.run.assert_any_call(['systemctl', 'stop', 'lumod-sessiond.service'])
        self.run.assert_any_call(['systemctl', 'disable', 'lumod-gateway.service'])
        self.run.assert_any_call(['systemctl', 'daemon-reload'])

    def test_purge_removes_only_lumo_records_without_following_symlinks(self):
        (installer.STATE / 'linked-personal-files').symlink_to(self.personal.parent, target_is_directory=True)
        installer.uninstall(self.config, purge=True, yes=True)
        self.assertFalse(installer.STATE.exists())
        self.assert_personal_files_preserved()

    def test_dry_run_changes_no_files_or_services(self):
        before = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        installer.uninstall(self.config, purge=True, dry_run=True)
        after = {p: p.read_bytes() for p in self.root.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        self.run.assert_not_called()
        self.assertIn('Preview only; no changes made.', self.output.getvalue())

    def test_noninteractive_uninstall_requires_explicit_confirmation(self):
        with patch.object(installer.sys.stdin, 'isatty', return_value=False):
            with self.assertRaisesRegex(RuntimeError, 'needs confirmation'):
                installer.uninstall(self.config)
        self.run.assert_not_called()
        self.assertTrue(installer.CONFIG.exists())

    def test_cancelled_purge_keeps_everything(self):
        with patch.object(installer.sys.stdin, 'isatty', return_value=True), patch('builtins.input', return_value='no'):
            installer.uninstall(self.config, purge=True)
        self.run.assert_not_called()
        self.assertTrue(self.audit.exists())
        self.assertTrue(installer.CONTROL.exists())

    def test_failed_service_stop_preserves_installer_and_configuration_for_retry(self):
        self.run.side_effect = RuntimeError('service manager unavailable')
        with self.assertRaisesRegex(RuntimeError, 'service manager unavailable'):
            installer.uninstall(self.config, yes=True)
        self.assertTrue(installer.CONFIG.exists())
        self.assertTrue(installer.CONTROL.exists())
        self.assertTrue(installer.PAM.exists())
        self.assertTrue(installer.TLS.exists())

    def test_stop_units_only_resets_units_with_a_failure_to_clear(self):
        def command(args, **kwargs):
            if args[:3] == ['systemctl', 'show', '--property=LoadState']:
                return 'loaded\n'
            if args[:3] == ['systemctl', 'show', '--property=ActiveState']:
                return 'failed\n' if args[-1] == 'lumo-cert-renew.service' else 'inactive\n'
            if args[:2] == ['systemctl', 'reset-failed'] and args[-1] != 'lumo-cert-renew.service':
                raise RuntimeError('Unit not loaded')
            return ''

        self.run.side_effect = command
        installer.uninstall(self.config, yes=True)
        resets = [call.args[0][-1] for call in self.run.call_args_list
                  if call.args[0][:2] == ['systemctl', 'reset-failed']]
        self.assertEqual(resets, ['lumo-cert-renew.service'])
        self.assertFalse(installer.CONTROL.exists())
        self.assertFalse(installer.LEGACY_CONTROL.exists())
        self.assert_personal_files_preserved()

    def test_uninstall_from_lumo_terminal_is_blocked_before_stopping_its_own_session(self):
        installer.write(installer.PROCESS_CGROUP, '0::/system.slice/lumod-sessiond.service\n')
        with self.assertRaisesRegex(RuntimeError, 'SSH or the VPS console'):
            installer.uninstall(self.config, yes=True)
        installer.uninstall(self.config, dry_run=True)
        self.run.assert_not_called()
        self.assertTrue(installer.CONFIG.exists())

    def test_source_command_can_repeat_and_purge_after_safe_uninstall(self):
        with patch.object(installer, 'require_host'):
            installer.main(['uninstall', '--yes'])
            self.assertTrue(self.audit.exists())
            self.run.reset_mock()
            installer.main(['uninstall', '--yes'])
            self.run.assert_not_called()
            installer.main(['uninstall', '--purge', '--yes'])
            self.assertFalse(installer.STATE.exists())
        self.assert_personal_files_preserved()

    def test_preview_does_not_create_install_lock(self):
        with patch.object(installer, 'require_host'):
            installer.main(['uninstall', '--dry-run'])
        self.assertFalse(installer.LOCK.exists())
        self.run.assert_not_called()

    def test_uninstall_rejects_options_that_could_be_mistaken_for_a_remote_target(self):
        with contextlib.redirect_stderr(io.StringIO()), patch.object(installer, 'require_host') as host:
            with self.assertRaises(SystemExit) as error:
                installer.main(['uninstall', '--host', 'another.example.com', '--yes'])
        self.assertEqual(error.exception.code, 2)
        host.assert_not_called()
        self.run.assert_not_called()

    def test_only_recorded_group_additions_are_removed(self):
        self.config['added_groups'] = {'lumo-users': 600, 'lumo-admin': 601}
        user = SimpleNamespace(pw_uid=1234, pw_gid=1234)
        groups = {name: SimpleNamespace(gr_gid=gid, gr_mem=['lumo_test'])
                  for name, gid in {'lumo-users': 600, 'lumo-admin': 601, 'systemd-journal': 602}.items()}
        with patch.object(installer.pwd, 'getpwnam', return_value=user), \
             patch.object(installer.grp, 'getgrnam', side_effect=lambda name: groups[name]):
            installer.uninstall(self.config, yes=True)
        removed = [c.args[0][-1] for c in self.run.call_args_list if c.args[0][0] == 'gpasswd']
        self.assertEqual(removed, ['lumo-users', 'lumo-admin'])
        self.assert_personal_files_preserved()

    def test_reused_user_id_stops_before_any_changes(self):
        self.config['added_groups'] = {'lumo-users': 600}
        with patch.object(installer.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=9876)):
            with self.assertRaisesRegex(RuntimeError, 'identity changed'):
                installer.uninstall(self.config, yes=True)
        self.run.assert_not_called()
        self.assertTrue(installer.CONFIG.exists())

    def test_only_empty_unused_installer_created_groups_are_deleted(self):
        self.config['created_groups'] = {'lumo-users': 600, 'lumo-admin': 601, 'lumo-gw': 602}
        groups = {'lumo-users': SimpleNamespace(gr_gid=600, gr_mem=[]),
                  'lumo-admin': SimpleNamespace(gr_gid=601, gr_mem=['another-user']),
                  'lumo-gw': SimpleNamespace(gr_gid=602, gr_mem=[])}
        with patch.object(installer.grp, 'getgrnam', side_effect=lambda name: groups[name]), \
             patch.object(installer.pwd, 'getpwall', return_value=[SimpleNamespace(pw_gid=602)]):
            installer.uninstall(self.config, yes=True)
        removed = [c.args[0][-1] for c in self.run.call_args_list if c.args[0][0] == 'groupdel']
        self.assertEqual(removed, ['lumo-users'])

    def test_preexisting_certificate_tooling_and_legacy_certificates_are_preserved(self):
        self.config.update(acme_isolated=False, certbot_owned=False, cert_source=str(self.external_cert))
        installer.uninstall(self.config, yes=True)
        self.assertTrue(installer.CERTBOT.parent.parent.exists())
        self.assertTrue(self.external_cert.exists())
        self.assertIn('Kept externally stored certificate:', self.output.getvalue())

    def test_symlink_parent_is_rejected_without_touching_target(self):
        link = self.root / 'unit-link'
        link.symlink_to(installer.UNIT_DIR, target_is_directory=True)
        with patch.object(installer, 'UNIT_DIR', link):
            with self.assertRaisesRegex(RuntimeError, 'symlink directory'):
                installer.uninstall(self.config, yes=True)
        self.run.assert_not_called()
        self.assertTrue(installer.CONFIG.exists())

    def test_mounted_data_is_rejected_before_any_mutation(self):
        with patch.object(installer.os.path, 'ismount', side_effect=lambda path: path == installer.STATE):
            with self.assertRaisesRegex(RuntimeError, 'Unmount'):
                installer.uninstall(self.config, purge=True, yes=True)
        self.run.assert_not_called()
        self.assertTrue(self.audit.exists())

    def test_supplied_certificate_inside_app_state_requires_relocation(self):
        self.config.update(acme=False, cert_source=str(self.audit), key_source=str(self.external_cert))
        with self.assertRaisesRegex(RuntimeError, 'Move your supplied certificate'):
            installer.uninstall(self.config, yes=True)
        self.run.assert_not_called()
        self.assertTrue(self.audit.exists())


if __name__ == '__main__':
    unittest.main()
