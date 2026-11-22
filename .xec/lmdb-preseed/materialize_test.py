"""Exercise the published directory and interrupted-copy protocol on a disposable Linux filesystem."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


ch = load_module('omnitron_preseed_channel', HERE.parent / 'block-preseed' / 'endpoint.py')
prep = load_module('prepare_data', HERE / 'materialize.py')


@unittest.skipUnless(sys.platform == 'linux' and os.getuid() == 0, 'requires a private root-owned Linux fixture')
class PrepareData(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir='/root')
        self.addCleanup(self.temp.cleanup)
        root = Path(self.temp.name)
        op = '4cb34f77-5d58-4289-9d33-e49a992f64d4'
        ch.ROOT = root / 'state'
        self.state = ch.ROOT / op
        self.state.mkdir(parents=True)
        ch.HOST_KEY = root / 'host.pub'
        raw = bytes.fromhex('0000000b7373682d6564323535313900000020') + bytes(range(32))
        ch.HOST_KEY.write_text('ssh-ed25519 ' + base64.b64encode(raw).decode())
        self.spec = {'id': op, 'receiverFingerprint': ch.fingerprint(ch.key_text(ch.HOST_KEY)),
                     'payload': 'monero-lmdb-compact-v1', 'nettype': 'mainnet', 'maxBytes': 128 * 1024,
                     'stageParent': str(root)}
        self.offer = {'spec': ch.digest(ch.canonical(self.spec)), 'manifest': 'b' * 64}
        self.stage = ch.stage_path(self.spec)
        self.stage.mkdir(mode=0o700)
        self.source = self.stage / 'data.mdb'
        data = b'public storage fixture\n' * 2048
        self.source.write_bytes(data)
        self.source.chmod(0o400)
        ch.write_record(self.state / 'spec.json', self.spec)
        ch.write_record(self.state / 'stage.json', {'identity': [self.stage.stat().st_dev, self.stage.stat().st_ino]})
        self.seal = {'sealed': True, 'stage': str(self.stage), 'offer': ch.digest(ch.canonical(self.offer)),
                     'manifest': self.offer['manifest'], 'format': self.spec['payload'], 'bytes': len(data),
                     'sha256': hashlib.sha256(data).hexdigest(), 'database': {'height': 100}}
        ch.write_record(self.state / 'sealed.json', self.seal)

    def prepare(self, reserve=0):
        return prep.main(self.spec, self.offer, self.seal, reserve)

    def test_independent_copy_and_exact_replay(self):
        result = self.prepare()
        output = Path(result['dataDir']) / 'lmdb/data.mdb'
        self.assertEqual(result, self.prepare())
        self.assertEqual(output.read_bytes(), self.source.read_bytes())
        self.assertFalse(output.samefile(self.source))
        self.assertEqual(output.stat().st_mode & 0o777, 0o600)
        output.write_bytes(b'x' * result['bytes'])
        with self.assertRaises(ch.Refusal):
            self.prepare()
        self.assertEqual(prep.file_hash(self.source), self.seal['sha256'])

    def test_resume_between_ready_receipt_and_publication(self):
        with patch.object(prep.os, 'rename', side_effect=OSError('fixture interruption')):
            with self.assertRaises(OSError):
                self.prepare()
        with patch.object(prep.subprocess, 'run', side_effect=AssertionError('duplicate copy')):
            self.assertEqual(self.prepare()['sha256'], self.seal['sha256'])

    def test_refuses_occupied_name_or_inconsistent_receipt(self):
        destination = self.stage.parent / ('monero-data-' + self.spec['id'])
        destination.mkdir()
        with self.assertRaises(ch.Refusal):
            self.prepare()
        destination.rmdir()
        self.seal['sha256'] = '0' * 64
        with self.assertRaises(ch.Refusal):
            self.prepare()
        self.assertFalse(destination.exists())

    def test_bound_space_and_selected_file(self):
        with self.assertRaises(ch.Refusal):
            self.prepare(16 * 1024 ** 4)
        (self.stage / 'unrelated').touch()
        with self.assertRaises(ch.Refusal):
            self.prepare(16 * 1024 ** 4)


if __name__ == '__main__':
    unittest.main()
