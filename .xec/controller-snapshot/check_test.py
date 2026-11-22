import contextlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import time
import unittest
import uuid
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded

ch = module('omnitron_preseed_channel', HERE.parent / 'block-preseed' / 'endpoint.py')
files = module('controller_files', HERE / 'files.py')
maintenance = module('controller_maintenance', HERE / 'maintenance.py')
endpoint = module('snapshot_endpoint', HERE / 'endpoint.py')


class ClosedControllerSnapshot(unittest.TestCase):
    def setUp(self):
        base = os.environ.get('OMNITRON_SNAPSHOT_TEST_ROOT', str(Path.home()))
        holder = tempfile.TemporaryDirectory(dir=base)
        self.addCleanup(holder.cleanup)
        self.root = Path(holder.name)
        self.home = self.root / 'home'
        self.home.mkdir(mode=0o700)
        self.stage = self.root / 'stage'
        self.stage.mkdir(mode=0o700)
        self.roster = []
        self.uid = os.geteuid()
        self.spec = {'maxBytes':256*1024**2,'sourceUid':self.uid}
        for pos, (folder, name) in enumerate(files.DATABASES):
            dest = self.home / folder
            dest.mkdir(exist_ok=True, mode=0o700)
            file = dest / name
            with contextlib.closing(sqlite3.connect(file)) as db:
                db.execute('CREATE TABLE entries(v TEXT)')
                db.execute('INSERT INTO entries VALUES (?)', ('base-' + str(pos),))
                db.commit()
            file.chmod(0o600)
            self.roster.append(file)

    def rows(self):
        with files.controller(self.home, self.uid) as (dirs, dev):
            rows = files.inventory(dirs, dev, self.uid)
            return files.manifest(dirs, rows)

    def transplant(self, rows):
        for slot in rows:
            folder, name = files.SLOTS[slot]
            shutil.copyfile(self.home / folder / name, self.stage / slot)

    def commit_final_wal(self):
        code = """import sqlite3,os,sys
d=sqlite3.connect(sys.argv[1]); d.execute('PRAGMA journal_mode=WAL'); d.execute('PRAGMA wal_autocheckpoint=0')
d.execute('INSERT INTO entries VALUES (?)',(sys.argv[2],)); d.commit(); os._exit(0)
"""
        for row, file in enumerate(self.roster):
            subprocess.run([sys.executable,'-c',code,str(file),'final-wal-'+str(row)],check=True)
            with contextlib.closing(sqlite3.connect(file.as_uri()+'?immutable=1',uri=True)) as db:
                self.assertEqual(db.execute('SELECT count(*) FROM entries').fetchone(), (1,))

    def test_last_transaction_only_in_wal_survives_raw_seal_and_independent_sqlite_recovery(self):
        self.commit_final_wal()
        rows=self.rows(); files.check_manifest(rows,self.spec)
        self.assertTrue(all(x+'-wal' in rows for x in files.MAINS))
        self.transplant(rows); files.verify_raw(self.stage,rows)
        self.assertGreaterEqual(files.check_recovery(self.stage,rows,self.root,0), 4)
        files.verify_raw(self.stage,rows)
        restored=self.root/'restored';restored.mkdir()
        for slot in rows:
            shutil.copyfile(self.stage/slot,restored/slot)
        for idx, slot in enumerate(files.MAINS):
            with contextlib.closing(sqlite3.connect(restored/slot)) as db:
                self.assertEqual(db.execute('select v from entries order by rowid').fetchall(),
                                 [('base-'+str(idx),),('final-wal-'+str(idx),)])
        (self.stage/'d0-wal').write_bytes(b'altered')
        with self.assertRaises(files.Refused): files.verify_raw(self.stage,rows)

    def test_only_physical_fixed_files_and_reserve(self):
        secret=self.home/'outside';secret.write_text('unrelated');original=self.roster[0]
        os.link(original,self.home/'alias')
        with self.assertRaises(files.Refused): self.rows()
        (self.home/'alias').unlink();original.unlink();original.symlink_to(secret)
        with self.assertRaises(files.Refused): self.rows()
        with self.assertRaises(files.Refused): endpoint.assert_space(self.home,2**62)
        with self.assertRaises(files.Refused): files.check_manifest({'outside':{}},self.spec)

    def test_stale_or_foreign_clean_owner_is_refused(self):
        units={u:{'ActiveState':'inactive','SubState':'dead','MainPID':'0'} for u in maintenance.UNITS}
        source={'boot':'original','units':{u:{'pid':46543219+i,'invocation':'1'*32,'cgroup':'/system.slice/'+u} for i,u in enumerate(maintenance.UNITS)}}
        expected={'clean':True,'pid':46543219,'bootId':'original'}
        group = self.root / 'cgroups'
        group.mkdir()
        (group / 'cgroup.controllers').touch()
        with patch.object(maintenance,'units',return_value=units),patch.object(maintenance,'holder',return_value=(expected,['a'])),patch.object(maintenance,'CGROUP',group):
            closed=maintenance.stopped({'ownerReceipt':'/test/managed-owner.json','sourceUid':0},source)
            self.assertEqual(closed['ownerPid'],46543219)
            left = group / 'system.slice' / maintenance.UNITS[0]
            left.mkdir(parents=True)
            (left / 'cgroup.events').write_text('populated 1\n')
            with self.assertRaises(files.Refused): maintenance.stopped({'ownerReceipt':'/test','sourceUid':0},source)
        with patch.object(maintenance,'units',return_value=units),patch.object(maintenance,'holder',return_value=({**expected,'pid':46543211},['a'])):
            with self.assertRaises(files.Refused): maintenance.stopped({'ownerReceipt':'/t','sourceUid':0},source)
        with patch.object(maintenance,'units',return_value={**units,maintenance.UNITS[1]:{'ActiveState':'activating'}}):
            with self.assertRaises(files.Refused): maintenance.stopped({'ownerReceipt':'/t','sourceUid':0},source)

    def test_forced_receiver_admits_one_slot_and_one_direction(self):
        command='rsync --server -Ie.LsfxCIvu --timeout=120 --bwlimit=20480 --partial --fsync . d0-wal'
        pull_command=command.replace('--server','--server --sender').replace('--partial --fsync','--inplace')
        self.assertIn('-wo',endpoint.forced(command,self.stage,False))
        self.assertIn('-ro',endpoint.forced(pull_command,self.stage,True))
        for not_allowed,pull in [(command,True),(command.replace('d0-wal','../outside'),False),('sh -c whoami',False),
                                 (command.replace('d0-wal','d4'),False),(command.replace('--fsync', '--files-from=/outside'),False),
                                 (command.replace('d0-wal','d0 d1'),False),(pull_command.replace('d0-wal','manifest'),True)]:
            with self.assertRaises(files.Refused): endpoint.forced(not_allowed,self.stage,pull)

    def test_endpoint_keys_deadline_and_exact_local_consent(self):
        spec = {'ttlMinutes': 5, 'id': str(uuid.uuid4())}
        now = int(time.time())
        entry = {'side': 'source', 'spec': files.digest(spec), 'schema': 1, 'expires': now + 250}
        self.assertEqual(endpoint.check_consent(spec, 'source', entry), entry['expires'])
        for changed in ({'spec': 'f' * 64}, {'expires': now - 1}, {'side': 'receiver'}, {'expires': now + 600}):
            with self.assertRaises(files.Refused):
                endpoint.check_consent(spec, 'source', {**entry, **changed})
        with self.assertRaises(files.Refused):
            endpoint.check_consent(spec, 'receiver', {**entry, 'side': 'receiver', 'key': 'old'}, 'different')

    def test_systemd_reload_allows_time_for_generators_and_still_requires_success(self):
        finished = subprocess.CompletedProcess([], 0, stdout=b'')
        with patch.object(maintenance.subprocess, 'run', return_value=finished) as run:
            maintenance.system('show', 'omnitron-owner.service')
            self.assertEqual(run.call_args.kwargs['timeout'], 25)
            maintenance.system('daemon-reload')
            self.assertEqual(run.call_args.kwargs['timeout'], 180)
        with patch.object(maintenance.subprocess, 'run', return_value=subprocess.CompletedProcess([], 1, stdout=b'')):
            with self.assertRaises(files.Refused):
                maintenance.system('daemon-reload')

    def test_empty_or_corrupt_database_does_not_seal(self):
        self.roster[0].write_bytes(b'')
        rows = self.rows()
        self.transplant(rows)
        with self.assertRaises(files.Refused):
            files.check_recovery(self.stage, rows, self.root, 0)

    def test_signed_closed_capture_and_in_place_return_using_both_stock_rsync_directions(self):
        rsync, restricted = shutil.which('rsync'), shutil.which('rrsync')
        self.assertTrue(rsync and restricted, 'GNU rsync and its packaged rrsync are required')
        if sys.platform == 'darwin':
            # Package rrsync hardcodes Apple's openrsync. Use the installed GNU executable at both ends.
            path = self.root / 'rrsync'
            implementation = Path(restricted).read_text()
            self.assertIn("RSYNC = '/usr/bin/rsync'", implementation)
            path.write_text(implementation.replace("RSYNC = '/usr/bin/rsync'", 'RSYNC = ' + repr(rsync), 1))
            path.chmod(0o700)
            restricted = str(path)
        # This transport connects two stock rsync processes over stdio inside this fixture.
        # The peer accepts only the command produced by the registered endpoint's forced policy.
        transport = self.root / 'fixture-rsh'
        transport.write_text('#!' + sys.executable + '\nimport os,sys,shlex\n'
                             'sys.dont_write_bytecode=True\nsys.path.insert(0,' + repr(str(HERE)) + ')\n'
                             'from check_test import endpoint\nfrom pathlib import Path\n'
                             'cmd=shlex.join(sys.argv[2:]); pull="--sender" in sys.argv[2:]\n'
                             'args=endpoint.forced(cmd,Path(' + repr(str(self.stage)) + '),pull)\n'
                             'os.environ["SSH_ORIGINAL_COMMAND"]=cmd\n'
                             'os.execv(' + repr(restricted) + ',[' + repr(restricted) + ']+args[1:])\n')
        transport.chmod(0o700)
        source, receiver = self.root / 'source-admin', self.root / 'receiver-admin'
        source.mkdir(); receiver.mkdir()
        op = str(uuid.uuid4())
        spec = {'id': op, 'sourceNode': 'node-a', 'receiverNode': 'node-b', 'sourceIp': '192.0.2.5',
                'receiverIp': '192.0.2.6', 'sourceFingerprint': 'SHA256:' + 'a' * 43,
                'receiverFingerprint': 'SHA256:' + 'b' * 43, 'receiverPort': 22, 'stageParent': '/srv/stage',
                'ownerReceipt': '/var/lib/example/execution/managed-owner.json', 'rateKiB': 20480, 'ttlMinutes': 30,
                'sourceReserveBytes': 1048576, 'receiverReserveBytes': 1048576, **self.spec}
        endpoint.validate(spec)
        s0, r0 = source / op, receiver / op
        s0.mkdir(); r0.mkdir()
        for directory in (s0, r0):
            ch.write_record(directory / 'spec.json', spec)
        anchor = {'boot': str(uuid.uuid4()), 'units': {u: {'pid': 800000+i, 'invocation': 'a'*32}
                                                       for i,u in enumerate(maintenance.UNITS)}}
        closed = {'anchor': files.digest(anchor), 'boot': anchor['boot'], 'ownerPid': 800000, 'receiptIdentity': ['original']}
        original_unlock = files.unlocked
        empty = self.root / 'locks'; empty.touch()
        with contextlib.ExitStack() as fixture:
            def replace(module, member, **args):
                return fixture.enter_context(patch.object(module, member, **args))
            replace(endpoint, 'RSYNC', new=rsync)
            replace(endpoint, 'local_consent', return_value=int(time.time()) + 1800)
            replace(endpoint, 'home', return_value=self.home)
            replace(ch, 'ssh_command', return_value=[str(transport), 'fixture', 'unused'])
            replace(maintenance, 'live', return_value=anchor)
            replace(maintenance, 'stopped', return_value=closed)
            replace(files, 'unlocked', side_effect=lambda stats: original_unlock(stats, empty))
            with patch.object(endpoint, 'ROOT', source):
                token = endpoint.offer(spec, s0)
                self.assertTrue(endpoint.check_consent(spec, 'receiver',
                                {'schema':1,'side':'receiver','spec':files.digest(spec),'expires':int(time.time())+50,
                                 'key':token['publicKey']}, token['publicKey']))
                provisional = endpoint.capture(spec, token, s0, cold=False)
                self.assertTrue(provisional['provisional'])
                self.assertEqual(set(os.listdir(self.stage)), set(files.MAINS))
                self.commit_final_wal()
                capture = endpoint.capture(spec, token, s0, cold=True)
            ch.write_record(r0 / ('approved-' + files.digest(token) + '.json'), {'offer': files.digest(token)})
            with patch.object(endpoint, 'ROOT', receiver):
                seal = endpoint.seal(self.stage, spec, token)
                self.assertEqual(seal['sha256'], capture['sha256'])
                self.assertEqual(seal['sqliteIntegrityChecks'], 4)
                self.assertGreaterEqual(seal['checkpointedWalFrames'], 4)
                with self.assertRaises((files.Refused, FileNotFoundError)):
                    endpoint.seal(self.stage, spec, {**token, 'issued':token['issued'] - 1})
            reverse = {**spec, 'id': str(uuid.uuid4()), 'restore': {'id': op, 'sha256': seal['sha256']}}
            s1 = source / reverse['id']; s1.mkdir()
            with patch.object(endpoint, 'ROOT', source):
                with patch.object(maintenance, 'stopped', return_value={**closed, 'receiptIdentity':['new-owner']}):
                    with self.assertRaises(files.Refused):
                        endpoint.offer(reverse, s1)
                ret = endpoint.offer(reverse, s1)
                original_inode = self.roster[0].stat().st_ino
                # Simulate a failed in-place copy and an obsolete sidecar before any new owner boot.
                with self.roster[0].open('r+b') as writable:
                    writable.write(b'failed copy')
                self.roster[1].with_name(self.roster[1].name+'-wal').unlink()
                self.roster[2].with_name(self.roster[2].name+'-journal').write_bytes(b'obsolete')
                systemd = self.root / 'systemd'
                systemd.mkdir()
                replace(maintenance, 'SYSTEMD', new=systemd)
                replace(maintenance, 'ADMIN_UID', new=self.uid)
                drops = {u: systemd / (u+'.d') / '95-omnitron-controller-snapshot.conf' for u in maintenance.UNITS}
                def manager(*args):
                    self.assertEqual(args, ('daemon-reload',))
                    return ''
                replace(maintenance, 'system', side_effect=manager)
                replace(maintenance, 'units', side_effect=lambda: {
                    u: {'DropInPaths': str(f) if f.is_file() else '', 'MainPID':'0','ActiveState':'inactive'} for u,f in drops.items()})
                def physical(path, root_owned):
                    self.assertTrue(root_owned and path.parent == systemd and path.resolve() == path)
                    return path
                replace(ch, 'physical', side_effect=physical)
                hold = replace(maintenance, 'lock_restore', wraps=maintenance.lock_restore)
                verify_hold = replace(maintenance, 'verify_hold', wraps=maintenance.verify_hold)
                release_hold = replace(maintenance, 'release_restore', wraps=maintenance.release_restore)
                if sys.platform != 'linux':
                    replace(endpoint, 'filesystem_kind', return_value='unknown')
                transfer = endpoint.transfer_file
                def interrupted(*args, **kw):
                    transfer(*args, **kw)
                    raise files.Refused('Fixture transport interrupted after a changed slot')
                with patch.object(endpoint, 'transfer_file', side_effect=interrupted):
                    with self.assertRaises(files.Refused): endpoint.restore(reverse, ret, s1)
                self.assertFalse((s1 / 'restored.json').exists())
                marker = s1 / 'restoring.json'
                self.assertTrue(marker.is_file())
                for f in drops.values():
                    self.assertEqual(f.read_text(), '[Unit]\nConditionPathExists=!' + str(marker) + '\n')
                wrong = drops[maintenance.UNITS[0]]
                wrong.write_text('[Unit]\n')
                with self.assertRaises(files.Refused):
                    maintenance.verify_hold(s1, reverse, ch.record(s0 / 'captured.json')['fence'])
                wrong.write_text(maintenance.condition_text(marker))
                with self.assertRaises(FileNotFoundError): endpoint.release(reverse, s1)
                release_hold.assert_not_called()
                answer = endpoint.restore(reverse, ret, s1)
                self.assertTrue(answer['servicesHeld'])
                self.assertEqual(answer['restored'], seal['sha256'])
                self.assertEqual(hold.call_count, 2)
                self.assertGreater(verify_hold.call_count, 4)
                self.assertEqual(self.roster[0].stat().st_ino, original_inode)
                self.assertFalse(endpoint.release(reverse, s1)['servicesStarted'])
                release_hold.assert_called_once()
                self.assertFalse(marker.exists() or any(f.exists() for f in drops.values()))
            for idx, file in enumerate(self.roster):
                with contextlib.closing(sqlite3.connect(file)) as db:
                    self.assertEqual(db.execute('SELECT v FROM entries ORDER BY rowid').fetchall(),
                                     [('base-' + str(idx),), ('final-wal-' + str(idx),)])

if __name__=='__main__':
    unittest.main()
