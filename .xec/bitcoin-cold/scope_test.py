import contextlib
import importlib.util
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    value = importlib.util.module_from_spec(spec)
    sys.modules[name] = value
    spec.loader.exec_module(value)
    return value


here = Path(__file__).resolve().parent
scope = module('bitcoin_cold_scope', here / 'scope.py')
channel = module('omnitron_preseed_channel', here.parent / 'block-preseed/endpoint.py')
endpoint = module('bitcoin_cold_endpoint', here / 'endpoint.py')


class ColdScope(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name).resolve()
        self.data = root / 'data'
        self.raw = root / 'external' / 'blocks'
        self.raw.mkdir(parents=True)
        for db in ('blocks/index', 'chainstate'):
            p = self.data / db
            p.mkdir(parents=True)
            for name, data in [
                ('CURRENT', b'MANIFEST-000001\n'),
                ('MANIFEST-000001', b'manifest'),
                ('000002.log', b''),
                ('LOCK', b''),
                ('LOG', b'private-local-log'),
            ]:
                (p / name).write_bytes(data)
        (self.data / '.lock').touch()
        (self.raw / '.lock').touch()
        for name, value in [
            ('blk00097.dat', b'hot'),
            ('rev00097.dat', b'undo'),
            ('blk00102.dat', b'cold'),
            ('xor.dat', b'12345678'),
        ]:
            if name != 'xor.dat':
                payload = value * 40
                frame = bytes.fromhex('fabfb5da') + len(payload).to_bytes(4, 'little') + payload
                value = bytes(b ^ b'12345678'[i % 8] for i, b in enumerate(frame))
            (self.raw / name).write_bytes(value)
        for name in ('wallets', 'onion-secret', 'cookie', 'bitcoin.conf', 'mempool.dat'):
            (self.data / name).write_text('excluded')
        self.spec = {'dataDir': str(self.data), 'blocks': str(self.raw), 'indexes': [], 'chain': 'regtest'}

    def test_prune_gaps_last_single_and_separate_blocksdir(self):
        names = scope.files(self.spec)
        self.assertEqual(names['blocks/xor.dat'], self.raw / 'xor.dat')
        self.assertIn('blocks/blk00102.dat', names)
        self.assertNotIn('blocks/rev00102.dat', names)
        self.assertIn('blocks/index/000002.log', names)
        self.assertNotIn('chainstate/LOCK', names)
        self.assertTrue(all(scope.permitted(self.spec, n) for n in names))
        for name in (
            'wallets/a',
            'blocks/../wallets/a',
            'blocks/.cookie',
            'blocks/index/LOG',
            'bitcoin.conf',
            'mempool.dat',
        ):
            self.assertFalse(scope.permitted(self.spec, name))

    def test_declared_optional_indexes_and_only_basic_filter_segments(self):
        self.spec['indexes'] = sorted(scope.INDEXES)
        for relative in scope.INDEXES.values():
            directory = self.data / relative
            directory.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(self.data / 'chainstate', directory)
        filter_file = self.data / 'indexes/blockfilter/basic/fltr00000.dat'
        filter_file.write_bytes(b'filter')
        included = scope.files(self.spec)
        self.assertIn('indexes/blockfilter/basic/fltr00000.dat', included)
        for relative in scope.INDEXES.values():
            self.assertIn(relative + '/CURRENT', included)
        (filter_file.parent / 'wallet.dat').write_bytes(b'excluded')
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)

    def test_wrong_network_or_other_xor_fails_before_content_can_be_transmitted(self):
        self.spec['chain'] = 'main'
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)
        self.spec['chain'] = 'regtest'
        (self.raw / 'xor.dat').write_bytes(b'87654321')
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)

    def test_unknown_leveldb_entries_bad_xor_snapshot_and_optional_indexes_refuse(self):
        for part in ('chainstate_snapshot', 'chainstate/wallet.dat', 'indexes/txindex'):
            p = self.data / part
            p.parent.mkdir(exist_ok=True)
            p.mkdir()
            with self.assertRaises(scope.Refused):
                scope.files(self.spec)
            p.rmdir()
        (self.raw / 'xor.dat').write_bytes(b'changed')
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)

    def test_symlink_hardlink_do_not_export(self):
        p = self.raw / 'blk00097.dat'
        p.unlink()
        p.symlink_to(self.data / 'wallets')
        with self.assertRaises(OSError):
            scope.inspect(p)
        p.unlink()
        os.link(self.data / 'wallets', p)
        with self.assertRaises(scope.Refused):
            scope.inspect(p)

    def test_candidate_layout_before_native_open_and_after_clean_shutdown(self):
        candidate = self.data.parent / 'candidate'
        root = candidate / 'regtest'
        shutil.copytree(self.raw, root / 'blocks')
        shutil.copytree(self.data / 'blocks/index', root / 'blocks/index')
        shutil.copytree(self.data / 'chainstate', root / 'chainstate')
        self.assertRegex(scope.target_layout(self.spec, candidate), r'^[0-9a-f]{64}$')
        outside = self.data / 'wallets'
        for dest in [root / 'wallets', root / 'chainstate/LOG', root / 'chainstate/000002.log']:
            previous = dest.read_bytes() if dest.exists() else None
            dest.unlink(missing_ok=True)
            dest.symlink_to(outside)
            with self.assertRaises(scope.Refused):
                scope.target_layout(self.spec, candidate)
            dest.unlink()
            if previous is not None:
                dest.write_bytes(previous)

    def test_separate_operations_serialize_the_same_canonical_target(self):
        root = self.data.parent
        install = {'dataDir': str(root / 'live'), 'unit': 'fixture.service', 'previous': {'kind': 'absent'}}
        lock = root / ('bitcoin-publication-' + channel.digest(os.fsencode(install['dataDir'])) + '.lock')
        with patch.object(channel, 'ROOT', root), channel.lock(lock, create=True):
            for phase in ('publish', 'restore'):
                with self.assertRaises(channel.Refusal):
                    endpoint.publish(phase, {}, {}, root, install)

    def test_real_exclusive_writer_blocks_read_fence_and_read_fence_blocks_writer(self):
        with patch.object(scope, 'require_stopped', return_value='200'):
            code = 'import fcntl,sys; f=open(sys.argv[1],"r+b"); fcntl.lockf(f,fcntl.LOCK_EX|fcntl.LOCK_NB); print("locked",flush=True); sys.stdin.readline()'
            for destination in (
                self.data / '.lock',
                self.raw / '.lock',
                self.data / 'chainstate/LOCK',
                self.data / 'blocks/index/LOCK',
            ):
                with contextlib.ExitStack() as stack:
                    worker = subprocess.Popen(
                        [sys.executable, '-c', code, str(destination)],
                        stdin=subprocess.PIPE,
                        stdout=subprocess.PIPE,
                        text=True,
                    )
                    stack.callback(worker.stdout.close)
                    stack.callback(worker.wait)
                    stack.callback(worker.stdin.close)
                    self.assertEqual(worker.stdout.readline().strip(), 'locked')
                    with self.assertRaises(scope.Refused), scope.fenced(self.spec):
                        pass
                with scope.fenced(self.spec):
                    blocked = subprocess.run(
                        [sys.executable, '-c', code, str(destination)],
                        stdin=subprocess.DEVNULL,
                        capture_output=True,
                    )
                    self.assertNotEqual(blocked.returncode, 0)

    def test_source_restart_while_reading_rejects_receipt(self):
        with patch.object(scope, 'require_stopped', side_effect=['123', '124']):
            with self.assertRaises(scope.Refused), scope.fenced(self.spec):
                pass

    def test_manifest_cannot_claim_hot_reuse_of_chainstate(self):
        rows = [
            [name, *scope.inspect(path), name.startswith('chainstate/')]
            for name, path in scope.files(self.spec).items()
        ]
        raw = channel.canonical(rows)
        review = {
            'manifest': channel.digest(raw),
            'files': len(rows),
            'bytes': sum(r[1] for r in rows),
            'reuseBytes': 0,
            'reuseFiles': 0,
        }
        with self.assertRaises(scope.Refused):
            endpoint.checked(self.spec, review, raw)

    def test_malformed_current_and_incomplete_optional_index(self):
        (self.data / 'chainstate/CURRENT').write_bytes(b'../wallets\n')
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)
        self.spec['indexes'] = ['coinstatsindex']
        with self.assertRaises(scope.Refused):
            scope.files(self.spec)


if __name__ == '__main__':
    unittest.main()
