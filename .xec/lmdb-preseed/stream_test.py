import importlib.util
import io
import os
from pathlib import Path
import signal
import struct
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


here = Path(__file__).resolve().parent
channel = load('omnitron_preseed_channel', here.parent / 'block-preseed' / 'endpoint.py')
stream = load('private_fixture', here / 'stream.py')


class PrivateSnapshot(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.spec = {'id': 'test', 'helperSha256': '0' * 64, 'maxBytes': 64}
        self.value = {'id': 'test', 'publicKey': 'example'}

    def frame(self, chunks, proof=None):
        out = io.BytesIO()
        stream.json_frame(out, {'protocol': stream.FORMAT, 'offer': channel.digest(channel.canonical(self.value))})
        for data in chunks:
            out.write(struct.pack('!I', len(data)) + data)
        if proof is not None:
            out.write(struct.pack('!I', 0))
            stream.json_frame(out, proof)
        out.seek(0)
        return out

    def test_restart_discards_partial_and_never_overwrites_completion(self):
        check = lambda: None
        with self.assertRaises(channel.Refusal):
            stream.receive(self.base, self.spec, self.value, self.frame([b'old']), io.BytesIO(), check)
        self.assertEqual((self.base / '.part').read_bytes(), b'old')
        data = b'fresh transaction'
        proof = {'body': stream.payload_receipt(self.spec, self.value, len(data), channel.digest(data)), 'signature': 'fixture'}
        out = io.BytesIO()
        stream.receive(self.base, self.spec, self.value, self.frame([data], proof), out, check)
        self.assertEqual(out.getvalue(), b'RD')
        with self.assertRaisesRegex(channel.Refusal, 'complete candidate'):
            stream.receive(self.base, self.spec, self.value, self.frame([b'new']), io.BytesIO(), check)
        self.assertEqual((self.base / '.part').read_bytes(), data)
        self.assertFalse((self.base / 'data.mdb').exists())

    def test_unknown_ack_can_only_accept_matching_proof_and_grant(self):
        if not Path('/usr/bin/ssh-keygen').exists():
            self.skipTest('OpenSSH required')
        state, stage = self.base / 'test', self.base / 'stage'
        state.mkdir(); stage.mkdir()
        subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-C', '', '-N', '', '-f', str(state / 'identity')], check=True)
        self.value.update(publicKey=channel.key_text(state / 'identity.pub'), anchor={'height': 2, 'genesis': 'a', 'tip': 'b'})
        self.spec['minimumHeight'] = 2
        token = channel.digest(channel.canonical(self.value))
        proof = stream.sign(state, stream.payload_receipt(self.spec, self.value, 4, channel.digest(b'file')))
        channel.write_record(stage / '.proof.json', proof)
        (stage / '.part').write_bytes(b'file')
        with patch.object(channel, 'ROOT', self.base), patch.object(stream, 'producer', return_value='test'), \
                patch.object(stream, 'inspect', return_value={'height': 2, 'genesis': 'a', 'checkpointHash': 'b'}):
            with self.assertRaises(FileNotFoundError):
                stream.verify(stage, self.spec, self.value)
            channel.write_record(state / ('approved-' + token + '.json'), {'offer': token})
            (stage / '.part').write_bytes(b'edit')
            with self.assertRaisesRegex(channel.Refusal, 'bytes differ'):
                stream.verify(stage, self.spec, self.value)
            (stage / '.part').write_bytes(b'file')
            original = proof['body'].copy()
            proof['body']['bytes'] = 9
            channel.write_record(stage / '.proof.json', proof)
            with self.assertRaisesRegex(channel.Refusal, 'signature|verification'):
                stream.verify(stage, self.spec, self.value)
            proof['body'] = original
            channel.write_record(stage / '.proof.json', proof)
            with patch.object(stream, 'inspect', return_value={'height': 2, 'genesis': 'a', 'checkpointHash': 'wrong'}):
                with self.assertRaisesRegex(channel.Refusal, 'checkpoint'):
                    stream.verify(stage, self.spec, self.value)
            accepted = stream.verify(stage, self.spec, self.value)
            self.assertEqual(stream.verify(stage, self.spec, self.value), accepted)
            self.assertEqual([file.name for file in stage.iterdir()], ['data.mdb'])

    def test_floor_aborts_both_owned_processes_while_transmission_is_blocked(self):
        children = [subprocess.Popen(['/bin/sleep', '30'], start_new_session=True) for _ in range(2)]
        try:
            with patch.object(stream, 'POLL', 0.02), patch.object(stream, 'check_space', side_effect=[None, channel.Refusal('floor')]):
                guard = stream.SnapshotGuard(children, [self.base], time.time() + 60)
                guard.thread.start(); guard.thread.join(2)
                self.assertIsInstance(guard.failure, channel.Refusal)
                self.assertEqual([p.wait(timeout=2) for p in children], [-signal.SIGKILL] * 2)
        finally:
            for child in children:
                if child.poll() is None:
                    child.kill()
                child.wait()

    def test_floor_uses_unprivileged_available_blocks_on_each_source_filesystem(self):
        values = [os.statvfs_result([4096, 4096, 10**9, 10**9, n, 1, 1, 1, 0, 255]) for n in (stream.FLOOR // 4096, stream.FLOOR // 4096 - 1)]
        with patch.object(os, 'statvfs', side_effect=values):
            with self.assertRaisesRegex(channel.Refusal, '8 GiB'):
                stream.check_space(['database', 'operation'])


if __name__ == '__main__':
    unittest.main()
