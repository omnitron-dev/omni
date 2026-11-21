"""Native bootstrap/SSH acceptance in the disposable networkless service-data-fixture VM only."""
import base64
import contextlib
import gzip
import io
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
import time
import uuid
from endpoint_test import sample


def main(program):
    assert os.geteuid() == 0 and set(os.listdir('/sys/class/net')) == {'lo'}
    assert Path('/etc/hostname').read_text().strip() == 'service-data-fixture'
    assert Path(__file__).resolve().is_relative_to('/run/omni-rsync-fixture')
    assert 'omni-source' in Path('/proc/mounts').read_text()
    work=Path(tempfile.mkdtemp(dir='/run',prefix='service-data-native-'))
    code=Path(program).read_text()
    g={'__name__':'fixture_private','SELF':code}
    arguments=sys.argv
    sys.argv=['fixture']
    exec(compile(code,'service-data','exec'),g)
    sys.argv=arguments
    real=g['output']; common=g['ch']
    def native(*args):
        return subprocess.run(args,stdin=subprocess.DEVNULL,capture_output=True,check=True).stdout
    s=sample()
    s['id']=str(uuid.uuid4())
    s['stageParent']='/srv/omnitron-service-data-fixture'
    s['receiverPort']=36922
    Path(s['stageParent']).mkdir(mode=0o755,exist_ok=True)
    (work/'volumes').mkdir()
    for side in ('source','receiver'):
        key=work/(side+'-host')
        native('ssh-keygen','-q','-t','ed25519','-N','','-C','','-f',str(key))
        s[side+'Fingerprint']=common.fingerprint(common.key_text(work/(side+'-host.pub')))
    for row in s['volumes']:
        p=work/'volumes'/row['volume']/'_data'
        p.mkdir(parents=True)
        st=p.stat()
        row.update(device=str(st.st_dev),inode=str(st.st_ino))
        (p/'sample').write_bytes(secrets.token_bytes(135))
        if row['tag'].endswith('-data') and row['tag'].split('-')[0] in ('postgres','nominatim'):
            (p/'pg_wal').mkdir(); (p/'pg_wal'/'sample-wal').write_bytes(b'cold only')
    def output(args,**options):
        if args[0]!='docker':
            return real(args,**options)
        if args[1]=='info':
            return str(work).encode()
        if args[1]=='volume':
            row=next(r for r in s['volumes'] if r['volume']==args[-1])
            return json.dumps(dict(Name=row['volume'],Driver='local',Options=None,Mountpoint=str(work/'volumes'/row['volume']/'_data'))).encode()
        if args[1]=='inspect':
            rows=[r for r in s['volumes'] if r['container']==args[-1]]
            assert rows and args[3]=='container'
            tags={'omnitron.managed':'true','omnitron.project':s['project'],'omnitron.stack':s['stack'],'omnitron.service':g['identity'](rows[0])}
            mounts=[dict(RW=True,Name=r['volume'],Type='volume',Destination=r['target'],Source=str(work/'volumes'/r['volume']/'_data')) for r in rows]
            return json.dumps(dict(id=args[-1],image=rows[0]['image'],labels=tags,mounts=mounts)).encode()
        assert args[1:2]==['exec'] and args[3:]==['redis-cli','--raw','INFO','persistence']
        return b'aof_enabled:1\r\n'
    g['output']=output
    receiver_root=g['ROOT']
    source_root=work/'source-state'
    def phase(action,side,grants=None):
        print('Native fixture phase',action,side,file=sys.stderr,flush=True)
        g['ROOT']=source_root if side=='source' else receiver_root
        g['GRANTS']=grants
        common.HOST_KEY=work/(side+'-host.pub')
        sys.argv=['fixture',action,base64.b64encode(gzip.compress(json.dumps(s).encode())).decode()]
        out=io.StringIO()
        with contextlib.redirect_stdout(out):
            g['main']()
        return json.loads(out.getvalue())
    consent_dir=Path('/etc/omnitron/service-data-grants')
    consent_dir.mkdir(mode=0o700,parents=True,exist_ok=True)
    consent_file=consent_dir/(s['id']+'.json')
    assert not consent_file.exists()
    try:
        phase('bootstrap-source','source')
    except FileNotFoundError:
        pass
    else:
        raise AssertionError('Local consent was required')
    consent={'schema':1,'side':'source','spec':g['sha'](s),'expires':int(time.time())+1200}
    common.write_record(consent_file,consent)
    source=phase('bootstrap-source','source')
    assert source['redisPersistence']=='aof'
    assert source==phase('bootstrap-source','source')
    mounts=g['mounts']()
    for row in s['volumes']:
        assert 'ro' in mounts[str(source_root/s['id']/'exports'/row['tag'])][1]
    common.write_record(consent_file,{**consent,'side':'receiver','key':source['publicKey']})
    receiver=phase('bootstrap-receiver','receiver')
    assert receiver==phase('bootstrap-receiver','receiver')
    user=g['account_name'](s)
    grants={'source':source,'receiver':receiver}
    native('ip','link','set','lo','up')
    for addr in (s['sourceIp'],s['receiverIp']):
        native('ip','address','replace',addr+'/32','dev','lo')
    config=work/'sshd.conf'
    config.write_text('\n'.join(['Port '+str(s['receiverPort']),'ListenAddress '+s['receiverIp'],'HostKey '+str(work/'receiver-host'),
        'PidFile '+str(work/'sshd.pid'),'PasswordAuthentication no','KbdInteractiveAuthentication no','UsePAM yes',
        'PermitRootLogin no','AllowUsers '+user,'AuthorizedKeysFile .ssh/authorized_keys','LogLevel VERBOSE','']))
    Path('/run/sshd').mkdir(mode=0o755,exist_ok=True)
    server=subprocess.Popen(['/usr/sbin/sshd','-D','-e','-f',str(config)],stdout=subprocess.DEVNULL,stderr=sys.stderr)
    try:
        time.sleep(0.2)
        assert server.poll() is None
        assert phase('seed','source',grants)['provisional']
        target=Path(receiver['stage'])
        for row in s['volumes']:
            incoming=target/row['tag']
            assert (incoming/'sample').read_bytes()==(work/'volumes'/row['volume']/'_data'/'sample').read_bytes()
            assert not (incoming/'pg_wal').exists()
        assert phase('seed','source',grants)['provisional']
        assert phase('revoke-receiver','receiver')['revoked']
        assert phase('revoke-source','source')['revoked']
        print('Native endpoint bootstrap/renewal, six read-only binds, real pinned OpenSSH, forced UID, seed/resume and revoke passed.')
    finally:
        server.terminate()
        server.wait(timeout=5)
        for row in s['volumes']:
            native('umount',str(source_root/s['id']/'exports'/row['tag']))
        # PAM may briefly retain this fixture UID after OpenSSH exits.
        deadline=time.monotonic()+35
        while True:
            removed=subprocess.run(['/usr/sbin/userdel',user],capture_output=True)
            if removed.returncode==0:break
            if removed.returncode!=8 or time.monotonic()>=deadline:
                raise RuntimeError('Fixture transfer UID is still busy')
            time.sleep(1)

if __name__=='__main__':
    main(sys.argv[1])
