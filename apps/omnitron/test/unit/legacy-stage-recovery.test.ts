import fs from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterEach, expect, it, vi } from 'vitest';
import { openSqliteDatabase } from '@omnitron-dev/titan-database/sqlite';
import { RuntimeInstallation } from '../../src/daemon/runtime-installation.js';
import { recoverStageUnderGuards } from '../../src/commands/legacy-stage-recovery.js';
import { assertNoStageCompletion, lockStageGuards, readLegacyStageRecords } from '../../src/commands/legacy-stage-fence.js';
import { guardScript, renewScript, acquireScript, type LeaseRecord } from '../../src/services/node-deploy-lease.js';
import type { StageRecoveryRequest, StageSelection } from '../../src/shared/dto/nodes.js';

const roots: string[] = [], stores: RuntimeInstallation[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) await store.close();
  for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
const sha = (bytes: string) => createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const dir = fs.mkdtempSync(join(tmpdir(), 'legacy-passive-stage-')); roots.push(dir);
  const home = join(dir,'instance'), runtime = (await RuntimeInstallation.open(home))!; stores.push(runtime);
  const selector = { protocol:1, current:'d'.repeat(64), previous:null, bootstrap:null, revision:13, selectedAt:new Date().toISOString() };
  function put(key: string, value: unknown) {
    const db = openSqliteDatabase(join(home,'runtime/state.db'));
    try { db.prepare('INSERT OR REPLACE INTO state_kv(key,value,updated_at) VALUES(?,?,?)').run(key,JSON.stringify(value),new Date().toISOString()); }
    finally { db.close(); }
  }
  put('runtime.selection',selector);
  const lease: LeaseRecord = { token:randomUUID(), holder:'fixture-controller pid 100', stack:'stage managed kernel', startedAt:new Date().toISOString() };
  const exec = { schema:1, id:randomUUID(), token:lease.token, timeoutMs:3000 };
  const leaseBytes = Buffer.from(JSON.stringify(lease)), execBytes = Buffer.from(JSON.stringify(exec)+'\n');
  fs.writeFileSync(join(dir,'deploy.lease'),leaseBytes,{mode:0o600});
  fs.writeFileSync(join(dir,'deploy.execution.json'),execBytes,{mode:0o600});
  const bootA = randomUUID(), bootB = randomUUID(), machine = sha('fixture-machine');
  const request: StageRecoveryRequest = { action:'prepare', recordId:randomUUID(),scope:sha('reviewed-scope'),
    observation:{state:'unresolved-legacy-stage', bootId:bootA, machineIdSha256:machine,...readLegacyStageRecords(leaseBytes,execBytes)} };
  // OS identity inputs drive only these journal/selection tests. The Fleet Linux test observes the kernel across actual boots.
  for (const name of ['deploy.guard','deploy.execution.guard']) fs.writeFileSync(join(dir,name),'',{mode:0o600});
  const run = async (action: StageRecoveryRequest['action'], boot: string, requestScope = request.scope, noReply = false) => {
    const locks = process.platform === 'linux' ? lockStageGuards(dir,process.getuid!(),true) : null;
    try { return await recoverStageUnderGuards({...request,action,scope:requestScope},{
    uid:process.getuid!(), identity:{bootId:boot,machineIdSha256:machine},
    guard:{directory:dir,check: terminal => {
      if (locks) locks.check(terminal);
      else if (!terminal) assertNoStageCompletion(dir);
    }},
    select: async (scope, work) => runtime.exclusive(async () => {
      const selected = runtime.selection()!;
      const observed: StageSelection = { uid:process.getuid!(), gid:process.getgid!(), homeSha256:sha(home), current:selected.current,
        revision:selected.revision,selectionSha256:sha(JSON.stringify(selected)) };
      return work(observed, async challenge => {
        runtime.confirmStageSelection(scope,challenge,selected);
        if (noReply) throw Error('Selection confirmation reply lost');
      });
    },{stageFenceScope:scope}),
  }); } finally { locks?.close(); }
  };
  return { dir, home, put, selector, bootA, bootB, run, runtime, request, lease, leaseBytes, execBytes };
}
it('requires protected preparation on the original boot, exact bytes and a settled selection', async () => {
  const f = await fixture();
  await expect(f.run('finish',f.bootB)).rejects.toThrow();
  await expect(f.run('prepare',f.bootB)).rejects.toThrow('during the recorded boot');
  fs.symlinkSync('missing',join(f.dir,'deploy.execution.completed'));
  await expect(f.run('prepare',f.bootA)).rejects.toThrow('A completion record is present; use its own reconciliation protocol');
  fs.unlinkSync(join(f.dir,'deploy.execution.completed'));
  const prepared = await f.run('prepare',f.bootA);
  expect(await f.run('prepare',f.bootB)).toEqual(prepared);
  await expect(f.run('finish',f.bootA)).rejects.toThrow('different Linux boot');
  await expect(f.run('finish',f.bootB,sha('different admin or endpoint'))).rejects.toThrow('another observation');
  f.put('runtime.selection',{...f.selector,revision:14});
  await expect(f.run('finish',f.bootB)).rejects.toThrow('selection changed');
  f.put('runtime.selection',f.selector);
  f.put('runtime.lease',{token:randomUUID(),pid:2_000_000,acquiredAt:new Date().toISOString()});
  await expect(f.run('finish',f.bootB)).rejects.toThrow('unrelated installation lease');
  expect(fs.readFileSync(join(f.dir,'deploy.lease'))).toEqual(f.leaseBytes);
  expect(fs.readFileSync(join(f.dir,'deploy.execution.json'))).toEqual(f.execBytes);
});
it('leaves both fences after a lost service confirmation and returns the private archive receipt after retry',async () => {
  const f=await fixture();
  await f.run('prepare',f.bootA);
  await expect(f.run('finish',f.bootB,f.request.scope,true)).rejects.toThrow('reply lost');
  expect(fs.readFileSync(join(f.dir,'deploy.lease'))).toEqual(f.leaseBytes);
  expect(fs.readFileSync(join(f.dir,'deploy.execution.json'))).toEqual(f.execBytes);
  const receipt=await f.run('finish',f.bootB);
  expect(receipt).toMatchObject({state:'interrupted',decision:{bootId:f.bootB,commandOutcome:'unknown'},selection:{revision:13}});
  expect(JSON.stringify(receipt)).not.toContain(f.lease.token);
  const db=openSqliteDatabase(join(f.dir,'stage-fence-recovery/archive.db'),{readonly:true});
  try { expect(db.prepare('SELECT lease,execution FROM incident').get()).toEqual({lease:f.leaseBytes,execution:f.execBytes}); } finally { db.close(); }
  expect(await f.run('finish',f.bootB)).toEqual(receipt);
});
it.each(['deploy.lease','deploy.execution.json'])('resumes after interruption immediately following unlink of %s', async name => {
  const f=await fixture(); await f.run('prepare',f.bootA);
  const original=fs.unlinkSync, trap=vi.spyOn(fs,'unlinkSync').mockImplementation(file=>{
    original(file);
    if (file===join(f.dir,name)) throw Error('injected power cut');
  });
  await expect(f.run('finish',f.bootB)).rejects.toThrow('injected power cut');
  trap.mockRestore();
  expect(fs.existsSync(join(f.dir,'deploy.lease'))).toBe(false);
  expect(fs.existsSync(join(f.dir,'deploy.execution.json'))).toBe(name==='deploy.lease');
  // After the final fence had been withdrawn, another legitimate caller can occupy the same names.
  if (name==='deploy.execution.json') {
    const next={...f.lease,token:randomUUID()};
    fs.writeFileSync(join(f.dir,'deploy.lease'),JSON.stringify(next));
    fs.writeFileSync(join(f.dir,'deploy.execution.json'),JSON.stringify({schema:1,id:randomUUID(),token:next.token,timeoutMs:6000})+'\n');
    fs.writeFileSync(join(f.dir,'deploy.execution.completed'),'different completed operation');
  }
  expect((await f.run('finish',f.bootB)).state).toBe('interrupted');
  expect(fs.existsSync(join(f.dir,'deploy.lease'))).toBe(name==='deploy.execution.json');
  expect(fs.existsSync(join(f.dir,'deploy.execution.json'))).toBe(name==='deploy.execution.json');
});
it.skipIf(process.platform!=='linux')('admits the next ordinary lease and refuses renew and guarded work from the retired attempt',async () => {
  const f=await fixture();
  await f.run('prepare',f.bootA); await f.run('finish',f.bootB);
  const timing={dir:f.dir,leaseSec:120,renewEveryMs:30000};
  const sh=(cmd:string)=>spawnSync('/bin/sh',['-c',cmd],{encoding:'utf8'});
  expect(sh(renewScript(timing,f.lease.token)).stdout).toMatch(/^LOST/);
  expect(sh(guardScript(timing,f.lease.token,'true',1000)).status).toBe(73);
  const next={...f.lease,token:randomUUID(),stack:'fixture/qa'};
  expect(sh(acquireScript(timing,next)).stdout).toMatch(/ACQUIRED/);
  expect(sh(guardScript(timing,f.lease.token,'true',1000)).status).toBe(73);
  expect(sh(guardScript(timing,next.token,'true',1000)).status).toBe(0);
});
it('does not clear another installation lease or an unfinished activation, and excludes ordinary runtime selection', async () => {
  const f=await fixture(), other=(await RuntimeInstallation.open(f.home))!; stores.push(other);
  await f.runtime.exclusive(async () => {
    await expect(other.exclusive(async () => {})).rejects.toThrow('Another runtime operation');
    await expect(other.exclusive(async () => {},{stageFenceScope:f.request.scope})).rejects.toThrow('still live');
    await expect(other.exclusive(async () => {},{stageFenceScope:sha('different incident')})).rejects.toThrow('unrelated');
  },{stageFenceScope:f.request.scope});
  f.put('runtime.activation',{candidate:'1'.repeat(64),previous:'2'.repeat(64),checkpoint:join(f.home,'checkpoint'),startedAt:new Date().toISOString()});
  await expect(f.run('prepare',f.bootA)).rejects.toThrow('unsettled activation');
  expect(fs.readFileSync(join(f.dir,'deploy.lease'))).toEqual(f.leaseBytes);
});
it('retains the source records if their exact witnessed contents have changed',async () => {
  const f=await fixture();
  await f.run('prepare',f.bootA);
  const changed=Buffer.from(f.execBytes.toString().replace('3000','4000'));
  fs.writeFileSync(join(f.dir,'deploy.execution.json'),changed);
  await expect(f.run('finish',f.bootB)).rejects.toThrow('differs from the reviewed');
  expect(fs.readFileSync(join(f.dir,'deploy.execution.json'))).toEqual(changed);
  expect(fs.readFileSync(join(f.dir,'deploy.lease'))).toEqual(f.leaseBytes);
});
it('sends a fixed administrative command and returns only the reviewed fields or a known refusal',async () => {
  const {recoverRegisteredStageFence}=await import('../../src/services/legacy-stage-fence.js');
  const f=await fixture(), inspector='d'.repeat(64);
  await f.run('prepare',f.bootA);
  const receipt=await f.run('finish',f.bootB);
  const request={...f.request,action:'finish' as const};
  const run=vi.fn().mockResolvedValue({code:0,stdout:JSON.stringify({ok:true,data:{...receipt,privateTest:f.lease.token}})});
  expect(await recoverRegisteredStageFence(inspector,request,run)).toEqual(receipt);
  expect(run.mock.calls[0]![0]).toContain(' --json service recover-stage-fence finish --record '+request.recordId+' --scope '+request.scope);
  expect(run.mock.calls[0]![0]).not.toContain(f.lease.token);
  const calls=run.mock.calls.length;
  await expect(recoverRegisteredStageFence(inspector,{...request,scope:'invalid'},run)).rejects.toThrow('Invalid stage recovery');
  expect(run).toHaveBeenCalledTimes(calls);
  run.mockResolvedValueOnce({code:1,stdout:'',stderr:JSON.stringify({ok:false,error:'The runtime registry has an unrelated installation lease'})});
  await expect(recoverRegisteredStageFence(inspector,request,run)).rejects.toThrow('unrelated installation lease');
  run.mockResolvedValueOnce({code:1,stdout:'',stderr:JSON.stringify({ok:false,error:'Could not open the enrolled service runtime registry'})});
  await expect(recoverRegisteredStageFence(inspector,request,run)).rejects.toThrow('Could not open the enrolled service runtime registry');
  run.mockResolvedValueOnce({code:1,stdout:'',stderr:JSON.stringify({ok:false,error:f.lease.token})});
  await expect(recoverRegisteredStageFence(inspector,request,run)).rejects.not.toThrow(f.lease.token);
});
