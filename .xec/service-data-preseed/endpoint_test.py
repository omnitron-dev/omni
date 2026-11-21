"""Exercise the restricted sender/receiver and resume/cold checks with private disposable trees."""
import copy
import importlib.util
import json
import os
import pathlib
import shlex
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch
from types import SimpleNamespace

HERE = pathlib.Path(__file__).resolve().parent
P = pathlib.Path
def load(name, file):
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module

scope = load('service_data_scope', HERE / 'scope.py')
ep = load('service_endpoint_test', HERE / 'endpoint.py')

def sample():
    rows = []
    for i, (tag, (kind, target)) in enumerate(scope.FIXED.items(), 1):
        num = ['postgres','nominatim','redis','minio'].index(kind) + 1
        rows.append({'tag': tag, 'target':target,'volume':'fixture-'+tag,'container':str(num)*64,
                     'image':'sha256:'+str(num+4)*64,'device':'100','inode':str(100+i)})
    return {'id':'d24f5061-e7c7-4aa3-ad78-a9752ffe90ab','project':'fixture','stack':'test','sourceNode':'source','receiverNode':'receiver',
            'sourceIp':'192.0.2.10','receiverIp':'192.0.2.20','sourceFingerprint':'SHA256:'+'A'*43,'receiverFingerprint':'SHA256:'+'B'*43,
            'stageParent':'/srv/fixture','receiverPort':22,'rateKiB':1024,'ttlMinutes':60,
            'clusters':{'postgres':'100','nominatim':'200'},'volumes':rows}

class ScopeTest(unittest.TestCase):
    def test_native_cold_requirements_bind_system_identifiers_final_wal_and_redis(self):
        s=sample()
        with tempfile.TemporaryDirectory() as tmp:
            roots={r['tag']:P(tmp)/r['tag'] for r in s['volumes']}
            for root in roots.values():root.mkdir()
            segment='000000010000000000000005'
            for tag,major in [('postgres-data','17'),('nominatim-data','14')]:
                root=roots[tag]; (root/'PG_VERSION').write_text(major)
                (root/'pg_wal').mkdir(); (root/'pg_wal'/segment).write_bytes(b'full')
            (roots['nominatim-flatnode']/'flatnode.file').write_bytes(b'flat')
            (roots['nominatim-data']/'import-finished').touch()
            (roots['minio-data']/'.minio.sys').mkdir()
            (roots['minio-data']/'.minio.sys'/'format.json').write_text('{}')
            redis=roots['redis-data']; (redis/'appendonly.aof').write_bytes(b'commands')
            def validator(row,root,tool,*args):
                if 'pg_controldata' not in tool:
                    self.assertIn(tool,('redis-check-rdb','redis-check-aof'));return b''
                return ("Database system identifier: "+s['clusters'][scope.identity(row)]+"\nDatabase cluster state: shut down\n"+
                    "Latest checkpoint's REDO WAL file: "+segment+"\nBytes per WAL segment: 4\n").encode()
            with patch.object(ep,'output',return_value=b''),patch.object(ep,'run_validator',side_effect=validator):
                ep.check_cold(s,roots,roots,persistence='aof')
                (redis/'appendonly.aof').unlink()
                (redis/'dump.rdb').write_bytes(b'saved')
                with self.assertRaises(ValueError):ep.check_cold(s,roots,roots,persistence='aof')
                with patch.object(ep,'STOP','fenced',create=True),patch.object(ep,'local_record',return_value={'schema':1,'spec':scope.sha(s),'stop':'fenced','sha256':scope.hashlib.sha256(b'saved').hexdigest()}):
                    ep.check_cold(s,roots,roots,persistence='rdb',state=P(tmp))
                    (redis/'dump.rdb').write_bytes(b'stale')
                    with self.assertRaises(ValueError):ep.check_cold(s,roots,roots,persistence='rdb',state=P(tmp))
                (roots['postgres-data']/'pg_wal'/segment).write_bytes(b'x')
                with self.assertRaisesRegex(ValueError,'WAL'):ep.check_cold(s,roots,roots,persistence='aof')

    def test_locally_bound_lease(self):
        s=sample()
        now=int(time.time())
        consent={'schema':1,'side':'source','spec':scope.sha(s),'expires':now+60}
        with patch.object(ep,'local_record',return_value=consent):
            self.assertEqual(ep.local_consent(s,'source'),consent)
            with self.assertRaises(ValueError):ep.local_consent(s,'receiver')
        for change in [{'spec':'0'*64},{'expires':now-1},{'expires':now+5000}]:
            with patch.object(ep,'local_record',return_value={**consent,**change}):
                with self.assertRaises(ValueError):ep.local_consent(s,'source')

    def test_inode_metadata_is_bound_to_both_sides_of_the_native_comparison(self):
        with tempfile.TemporaryDirectory() as tmp:
            stage=P(tmp);root=stage/'postgres-data';root.mkdir()
            item=root/'bytes';item.write_bytes(b'constant')
            channel=SimpleNamespace(canonical=lambda s:json.dumps(s,separators=(',',':')).encode())
            with patch.object(ep,'ch',channel,create=True):
                rows=[{'tag':'postgres-data'}]
                before=ep.stage_stamp(stage,rows)
                item.chmod(0o600 if item.stat().st_mode & 0o044 else 0o640)
                self.assertNotEqual(before,ep.stage_stamp(stage,rows))

    def test_admission(self):
        s = sample()
        scope.validate_scope(s)
        for change in ('foreign','missing','alias','target','image','cluster'):
            with self.subTest(change=change):
                altered = copy.deepcopy(s)
                if change == 'foreign': altered['volumes'][0]['tag'] = 'wallets'
                if change == 'missing': altered['volumes'].pop()
                if change == 'alias': altered['volumes'][0]['inode'] = altered['volumes'][1]['inode']
                if change == 'target': altered['volumes'][0]['target'] = '/root'
                if change == 'image': altered['volumes'][2]['image'] = 'sha256:'+'0'*64
                if change == 'cluster': altered['clusters']['postgres'] = 'not-an-id'
                with self.assertRaises(ValueError): scope.validate_scope(altered)
    def test_unsafe_and_partial(self):
        s = sample(); row = s['volumes'][0]
        with tempfile.TemporaryDirectory() as tmp:
            root = P(tmp)/'volume'; root.mkdir()
            (root/'pg_tblspc').mkdir(); (root/'pg_tblspc'/'123').symlink_to('/root')
            with self.assertRaises(ValueError): scope.inventory(root,row,s['volumes'],metadata_only=True)
            (root/'pg_tblspc'/'123').unlink()
            (P(tmp)/'outside').write_bytes(b'private'); os.link(P(tmp)/'outside', root/'alias')
            with self.assertRaises(ValueError): scope.inventory(root,row,s['volumes'],metadata_only=True)
            (root/'alias').unlink()
            (root/'registry.credentials').write_bytes(b'forbidden')
            with self.assertRaises(ValueError): scope.inventory(root,row,s['volumes'],metadata_only=True)
            (root/'registry.credentials').unlink()
            (root/'.rsync-partial').mkdir()
            with self.assertRaises(ValueError): scope.inventory(root,row,s['volumes'],receiver=True)
    def test_receiver_commands(self):
        s = sample()
        for cmd in ['bash', 'rsync --server --sender . postgres-data/','rsync --server -r . ../../',
                    'rsync --server -r . wallets/', 'rsync --server -r . /root/']:
            with self.assertRaises(ValueError): ep.receiver_rsync(s,P('/stage'),cmd)
        args, original = ep.receiver_rsync(s,P('/stage'),'rsync --server -r . postgres-data/')
        self.assertEqual(args,['/usr/bin/rrsync','-wo','-munge','-no-lock','/stage/postgres-data'])
        self.assertEqual(original,'rsync --server -r . .')

    def test_plain_rsync_early_and_cold(self):
        s = sample(); row=s['volumes'][0]; rows=s['volumes']
        rsync, rrsync = shutil.which('rsync'), shutil.which('rrsync')
        self.assertIsNotNone(rsync,'GNU rsync fixture prerequisite')
        self.assertIsNotNone(rrsync,'rrsync fixture prerequisite')
        with tempfile.TemporaryDirectory() as tmp:
            tmp=P(tmp); src=tmp/'source'; src.mkdir(); dst=tmp/'stage'; dst.mkdir(); target=dst/row['tag'];target.mkdir()
            if sys.platform == 'darwin':
                # Homebrew ships upstream rrsync pointing at Apple's openrsync. Pair it with the GNU binary it ships.
                implementation = P(rrsync).read_text()
                self.assertIn("RSYNC = '/usr/bin/rsync'", implementation)
                fixture = tmp / 'rrsync'
                fixture.write_text(implementation.replace("RSYNC = '/usr/bin/rsync'", 'RSYNC = '+repr(rsync), 1))
                fixture.chmod(0o700)
                rrsync = str(fixture)
            cfg=tmp/'spec.json';cfg.write_text(json.dumps(s))
            # Exercise the installed rrsync protocol on stdio, with the caller and destination isolated from any SSH node.
            shell=tmp/'rsh'; shell.write_text('#!'+sys.executable+'\n'+
                'import os,shlex,sys\nfrom pathlib import Path\n'+
                'sys.path.insert(0,'+repr(str(HERE))+')\nfrom endpoint_test import ep,sample\n'+
                'args,cmd=ep.receiver_rsync(sample(),Path('+repr(str(dst))+'),shlex.join(sys.argv[2:]))\n'+
                'os.environ["SSH_ORIGINAL_COMMAND"]=cmd\nos.execv('+repr(rrsync)+',['+repr(rrsync)+']+args[1:])\n')
            shell.chmod(0o700)
            def send(cold, verify=False):
                args=ep.rsync_args(src,row,'private-node',[str(shell)],32768,cold,verify)
                args[0]=rsync
                result = subprocess.run(args, stdout=subprocess.PIPE,stderr=subprocess.PIPE)
                self.assertEqual(result.returncode, 0, result.stderr.decode())
                return result.stdout
            tablespace={**row,'tag':'postgres-tblspc-1234','volume':'fixture-pg-space','target':'/srv/tablespace','inode':'227'}
            rows.append(tablespace)
            (src/'pg_tblspc').mkdir(); (src/'pg_tblspc'/'1234').symlink_to('/srv/tablespace')
            (src/'pg_wal').mkdir(); (src/'pg_wal'/'wal').write_bytes(b'cold-wal'); (src/'base').write_bytes(b'one')
            (src/'obsolete').write_bytes(b'will disappear')
            send(False); self.assertFalse((target/'pg_wal').exists())
            self.assertEqual((target/'base').read_bytes(),b'one')
            before=(target/'base').stat(); send(False)
            self.assertEqual(before.st_ino,(target/'base').stat().st_ino)
            st=(src/'base').stat(); (src/'base').write_bytes(b'two'); os.utime(src/'base',ns=(st.st_atime_ns,st.st_mtime_ns))
            (src/'obsolete').unlink()
            send(True)
            self.assertEqual(send(True,True),b'')
            self.assertFalse((target/'obsolete').exists()); self.assertEqual((target/'pg_wal'/'wal').read_bytes(),b'cold-wal')
            self.assertEqual(scope.inventory(src,row,rows),scope.inventory(target,row,rows,receiver=True))
            # Decode the passive backup into a fresh tree. Only the local receiver may restore original metadata.
            restored = tmp/'restore'; restored.mkdir()
            local_copy=tmp/'local-rsync'
            local_copy.write_text('#!/bin/sh\nshift\nexec "$@"\n')
            local_copy.chmod(0o700)
            restored_process = subprocess.run([rsync,'-aHAXS','--numeric-ids','--fake-super','--munge-links',
                '-e',str(local_copy),'--rsync-path='+rsync,str(target)+'/','fixture-local:'+str(restored)+'/'],capture_output=True)
            self.assertEqual(restored_process.returncode, 0, restored_process.stderr.decode())
            self.assertEqual(scope.inventory(src,row,rows),scope.inventory(restored,row,rows))
            (target/'base').write_bytes(b'bad')
            self.assertNotEqual(scope.inventory(src,row,rows),scope.inventory(target,row,rows,receiver=True))
            self.assertTrue(send(True,True))

if __name__=='__main__': unittest.main()
