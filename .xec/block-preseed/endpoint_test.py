import io
import os
import pathlib
import struct
import tempfile
import unittest
from unittest.mock import patch

import endpoint as e


class BlockPreseed(unittest.TestCase):
    def test_source_priority_targets_this_process_and_fails_on_an_unapplied_policy(self):
        with patch.object(e.os, 'setpriority') as nice, patch.object(e.os, 'getpriority', return_value=19), \
                patch.object(e.shutil, 'which', return_value='/usr/bin/ionice'), patch.object(e, 'run') as ionice:
            e.lower_source_priority()
            nice.assert_called_once_with(os.PRIO_PROCESS, 0, 19)
            ionice.assert_called_once_with(['/usr/bin/ionice', '-c', '2', '-n', '7', '-p', str(os.getpid())])
            ionice.side_effect = e.Refusal('failed')
            with self.assertRaises(e.Refusal):
                e.lower_source_priority()
        with patch.object(e.os, 'setpriority'), patch.object(e.os, 'getpriority', return_value=19), \
                patch.object(e.shutil, 'which', return_value=None), patch.object(e, 'run') as ionice:
            e.lower_source_priority()
            ionice.assert_not_called()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name).resolve()
        self.src, self.dst = self.root / 'blocks', self.root / 'stage'
        self.src.mkdir()
        self.dst.mkdir()
        self.spec = {'firstActive': 3}
        for i in range(5):
            for family in ('blk', 'rev'):
                name = f'{family}{i:05d}.dat'
                (self.src / name).write_bytes(('public ' + name).encode())

    def rows(self, writers=()):
        with e.directory_fd(self.src) as folder, patch.object(e, 'open_writers', return_value=set(writers)):
            return e.select_rows(folder, self.spec['firstActive'])

    def frame(self, rows, payload=True):
        raw = e.canonical(rows)
        offer = {'manifest': e.digest(raw), 'files': len(rows), 'bytes': sum(row[1] for row in rows)}
        data = struct.pack('!I', len(raw)) + raw
        if payload:
            data += b''.join((self.src / row[0]).read_bytes() for row in rows if not (self.dst / row[0]).exists())
        return offer, data

    def test_only_regular_closed_pairs_and_no_recursive_discovery(self):
        for name in ('wallet.dat', 'xor.dat', 'blk00001.dat.bak', 'peers.dat'):
            (self.src / name).write_bytes(b'private fixture')
        (self.src / 'wallets').mkdir()
        (self.src / 'wallets' / 'blk00000.dat').write_bytes(b'private fixture')
        (self.src / 'rev00001.dat').unlink()
        active = (self.src / 'blk00002.dat').stat()
        self.assertEqual([row[0] for row in self.rows([(active.st_dev, active.st_ino)])], ['blk00000.dat', 'rev00000.dat'])
        self.spec['firstActive'] = 99999
        self.assertNotIn('rev00004.dat', [row[0] for row in self.rows()])

    def test_symlinks_hardlinks_directories_and_fifos_refuse(self):
        candidate = self.src / 'blk00000.dat'
        candidate.unlink()
        secret = self.root / 'outsider'
        secret.write_text('private fixture')
        for create in (lambda: candidate.symlink_to(secret), lambda: os.link(secret, candidate), lambda: os.mkfifo(candidate)):
            create()
            with self.assertRaises((e.Refusal, OSError)):
                self.rows()
            candidate.unlink()
        candidate.mkdir()
        with self.assertRaises((e.Refusal, OSError)):
            self.rows()

    def test_interruption_retry_and_exact_receiver_hash(self):
        rows = self.rows()
        offer, data = self.frame(rows)
        with self.assertRaises(e.Refusal):
            e.receive_stream(self.dst, self.spec, offer, io.BytesIO(data[:-4]), io.BytesIO())
        self.assertTrue((self.dst / '.part').is_file())
        offer, data = self.frame(rows)
        replies = io.BytesIO()
        e.receive_stream(self.dst, self.spec, offer, io.BytesIO(data), replies)
        self.assertEqual(replies.getvalue(), b'H' * (len(rows)-1) + b'SKD')
        self.assertEqual(sorted(p.name for p in self.dst.iterdir()), [row[0] for row in rows])
        with e.directory_fd(self.dst) as folder:
            self.assertEqual(rows, [e.inspect_file(folder, row[0]) for row in rows])
        (self.dst / rows[0][0]).write_text('wrong')
        with self.assertRaises(e.Refusal):
            e.receive_stream(self.dst, self.spec, offer, io.BytesIO(self.frame(rows)[1]), io.BytesIO())

    def test_unknown_names_malformed_commitment_and_unrelated_stage_are_rejected(self):
        rows = self.rows()
        for change in (lambda r: r[0].__setitem__(0, '../wallet.dat'), lambda r: r[0].__setitem__(0, 'blk00003.dat'),
                       lambda r: r.reverse(), lambda r: r.pop(), lambda r: r[0].__setitem__(2, 'x')):
            altered = [list(row) for row in rows]
            change(altered)
            offer, data = self.frame(altered, False)
            with self.assertRaises(e.Refusal):
                e.receive_stream(self.dst, self.spec, offer, io.BytesIO(data), io.BytesIO())
        offer, data = self.frame(rows)
        with self.assertRaises(e.Refusal):
            e.receive_stream(self.dst, self.spec, {**offer, 'manifest': '0'*64}, io.BytesIO(data), io.BytesIO())
        (self.dst / 'unrelated').touch()
        with self.assertRaises(e.Refusal):
            e.receive_stream(self.dst, self.spec, offer, io.BytesIO(data), io.BytesIO())
        self.assertEqual([x.name for x in self.dst.iterdir()], ['unrelated'])

    def test_read_only_source_refuses_changed_bytes_and_receiver_rejects_bad_content(self):
        rows = self.rows()
        original = self.frame(rows)
        (self.src / rows[0][0]).write_bytes(b'other')
        with e.directory_fd(self.src) as folder, tempfile.TemporaryFile() as verified:
            self.assertNotEqual(e.inspect_file(folder, rows[0][0], verified), rows[0])
        offer, wire = original
        prefix = 4 + len(e.canonical(rows))
        wrong = wire[:prefix] + bytes([wire[prefix] ^ 1]) + wire[prefix+1:]
        with self.assertRaises(e.Refusal):
            e.receive_stream(self.dst, self.spec, offer, io.BytesIO(wrong), io.BytesIO())
        self.assertFalse((self.dst / rows[0][0]).exists())


if __name__ == '__main__':
    unittest.main()
