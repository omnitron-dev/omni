import contextlib
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('host_binding_observer', Path(__file__).with_name('observe.py'))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class PassiveEvidence(unittest.TestCase):
    def test_missing_systemd_and_missing_properties_are_unknown(self):
        for rc, fields in [(1, b''), (0, b'LoadState=not-found\nActiveState=inactive\n')]:
            with patch.object(observer.subprocess, 'run', return_value=subprocess.CompletedProcess([], rc, fields, b'')):
                with self.assertRaises(ValueError):
                    observer.unit_state('bitcoind.service')

    def test_private_config_presence_requires_no_open_and_no_symlink_follow(self):
        with tempfile.TemporaryDirectory() as folder:
            fd = os.open(folder, os.O_RDONLY)
            try:
                path = Path(folder)
                os.mkfifo(path / 'private', 0)
                (path / 'link').symlink_to(path / 'private')
                with patch.object(observer, 'directory', return_value=contextlib.nullcontext(fd)):
                    self.assertEqual(observer.target_metadata('/etc/fixture/missing'), {'present': False})
                    for leaf in ('private', 'link'):
                        row = observer.target_metadata('/etc/fixture/' + leaf)
                        self.assertTrue(row['present'])
                        self.assertFalse(row['regular'])
            finally:
                os.close(fd)

    def test_inaccessible_config_ancestor_is_unknown(self):
        with patch.object(observer, 'directory', side_effect=PermissionError):
            with self.assertRaises(PermissionError):
                observer.target_metadata('/etc/fixture/private')

    def test_no_host_access_after_expiration_or_unapproved_paths(self):
        row = {'commit': 'a' * 40, 'bindings': []}
        params = {'review': row, 'stage': '/srv/fixture/host-units-aaaaaaaa', 'validUntil': 10}
        with patch.object(observer.time, 'time', return_value=10):
            with self.assertRaisesRegex(ValueError, 'expired'):
                observer.observe(params)
            params['validUntil'] = 11
            with self.assertRaisesRegex(ValueError, 'Unapproved'):
                observer.observe(params)


if __name__ == '__main__':
    unittest.main()
