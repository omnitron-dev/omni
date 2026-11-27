import type { Command } from '@xec-sh/core';
import { randomUUID } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import { adoptionBinding, adoptionDefinition } from '../../../../.xec/commands/service-data-adopt.js';
import { receiverProgram } from '../../../../.xec/commands/service-data-preseed.js';
import { createPipelineTestDatabase } from '../fixtures/pipeline-database.js';
import { runWithAuth } from '../../src/services/auth-context.js';
import { canonicalHash, sha256 } from '../../src/services/physical-restore-graph.js';
import { PipelineRpcService } from '../../src/services/pipeline.rpc-service.js';
import { PipelineService } from '../../src/services/pipeline.service.js';
import type { PipelineDef } from '../../src/shared/dto/pipelines.js';
import type { ExecutionService, SSHTarget } from '../../src/execution/execution.service.js';
import type { RehearsalCopyPlan } from '../../src/shared/dto/first-write.js';

const actor = (role = 'admin') => ({ userId: 'owner', roles: [role], permissions: [], metadata: { sessionId: 'private' } });
const tags = ['postgres-data','nominatim-data','nominatim-flatnode','nominatim-merged','redis-data','minio-data'];
const targets = ['/var/lib/postgresql/data', '/var/lib/postgresql/14/main','/nominatim/flatnode','/merged','/data','/data'];
async function recipe() {
  const source = { id: 'donor', host: '192.0.2.10', pin: 'SHA256:' + 'A'.repeat(43) };
  const receiver = { id: 'recipient', host: '192.0.2.20', pin: 'SHA256:' + 'B'.repeat(43) };
  const seed = { id: randomUUID(), sourceNode: source.id, receiverNode: receiver.id,
    sourceFingerprint: source.pin, receiverFingerprint: receiver.pin, sourceIp: source.host, receiverIp: receiver.host,
    receiverPort: 22, stageParent: '/srv/test-stage', rateKiB: 512, ttlMinutes: 60, project: 'fixture', stack: 'test',
    clusters: { postgres: '123', nominatim: '456' }, volumes: tags.map((tag,i) => ({ tag, target: targets[i],
      volume: 'v-' + i, container: String([1,2,2,2,3,4][i]).repeat(64), image: 'sha256:' + String([3,4,4,4,5,6][i]).repeat(64),
      device:'110', inode:String(200+i) })) };
  const observation = (name: string, nodeId: string, value: unknown) => ({ name, nodeId, status:'success', exitCode:0,
    outputTruncated:false, output:JSON.stringify(value) });
  const identity = { uid_map:[[0,0,4294967295]],gid_map:[[0,0,4294967295]] };
  const maps = { uid_map:[[0,991,1],[1,100000,65536]],gid_map:[[0,992,1],[1,100000,65536]] };
  const namespaces = { id: randomUUID(), status:'success', review:{digest:'1'.repeat(64)}, steps:[
    observation('source-volume-namespace', source.id, { maps: Object.fromEntries(tags.map(tag => [tag,identity])) }),
    observation('target-engine-namespace', receiver.id, { daemonUid:991,daemonPid:712,maps }) ] };
  const binding = await adoptionBinding(seed, namespaces);
  const trees = Object.fromEntries([...tags].sort().map(tag => [tag,{bytes:20, files:2,sha256:sha256(tag)}]));
  const cold = { id:seed.id, spec:binding.spec, stop:randomUUID(), trees, sha256:canonicalHash(trees) };
  const sealed = { id:seed.id,spec:binding.spec,stop:cold.stop,stage:seed.stageParent+'/service-data-'+seed.id, sha256:cold.sha256,sealed:true };
  const boot = { id:randomUUID(), status:'success',review:{digest:'2'.repeat(64)}, steps:[
    observation('bootstrap-receiver',receiver.id,{side:'receiver',spec:binding.spec,stage:sealed.stage}),
    observation('helper-part-1',receiver.id,{part:1,total:1,helperSha256:sha256(await receiverProgram())}) ] };
  const graph = await adoptionDefinition('verify',seed,namespaces,cold,sealed,boot) as PipelineDef;
  const result = { seed:seed.id,binding:canonicalHash(binding),stop:cold.stop,sha256:cold.sha256,
    identities:Object.fromEntries(tags.map((tag,i)=>[tag,['220',String(i+333)]])),verified:true,
    metadata:Object.fromEntries(tags.map(tag=>[tag,sha256('mode-'+tag)])),validatorProfileSha256:null,
    clusters:seed.clusters,volumes:binding.volumes,restored:true };
  return { seed, cold, source, receiver, graph, result };
}

describe('private native physical restore receipts', () => {
  it('opens the frozen graph at its ordinary RPC, compares both registered nodes and refuses drift and a different command', async () => {
    const f = await recipe();
    const db = createPipelineTestDatabase();
    const observed = { trees:f.cold.sha256, controls:{postgres:sha256('pg17'),nominatim:sha256('pg14'),minio:sha256('xl')},
      generation: Object.fromEntries(tags.map(tag=>[tag,sha256('generation-'+tag)])) };
    let targetControls = observed.controls;
    const exec = vi.fn(async () => ({ exitCode:0, stdout:'checked', stderr:'',duration:1 }));
    const ssh = vi.fn(async (target: SSHTarget, command: string, opts: {stdin:string}) => {
      expect(command).toMatch(/^\/usr\/bin\/python3 -I - (source|receiver) [A-Za-z0-9+/=]+$/);
      expect(opts.stdin).toContain('def inspect(side, proof, visit_receiver=None)');
      const payload = JSON.parse(Buffer.from(command.split(' ').at(-1)!, 'base64').toString()) as {seed:string, cold:string};
      expect(payload.seed).toBe(f.seed.id);
      expect(payload.cold).toBe(canonicalHash(f.cold));
      const pin = target.host === f.source.host ? f.source : f.receiver;
      expect(target.expectedHostFingerprint).toBe(pin.pin);
      return {exitCode:0,stdout:JSON.stringify({...observed,controls: target.host === f.source.host ? observed.controls : targetControls}),stderr:'',duration:1};
    });
    const scope = { project: f.seed.project, stack: f.seed.stack, sourceNode: f.source.id, sourceIp: f.source.host };
    const reads = vi.fn((args: string[]) => {
      for (const n of [f.source, f.receiver]) {
        if (args.at(-1) === n.id) {
          expect(args).toEqual(['--json', 'node', 'ssh-key', '--expect', n.pin, '--', n.id]);
          return { nodeId: n.id, fingerprint: n.pin };
        }
      }
      expect(args).toEqual(['--json', 'stack', 'confirm-stop', '--operation', f.cold.stop, '--source-node', f.source.id,
        '--source-host', f.source.host, '--', f.seed.project, f.seed.stack]);
      return { ...scope, operation: f.cold.stop };
    });
    const execute = vi.fn(async (command: Command) => {
      let stdout = command.adapter === 'ssh' ? JSON.stringify(f.result) : 'checked';
      if (command.command === 'omnitron') {
        expect(command).toMatchObject({ adapter: 'local', shell: false });
        stdout = JSON.stringify({ ok: true, data: reads(command.args ?? []) });
      }
      return { exitCode: 0, stdout, stderr: '', duration: 1 };
    });
    const uploadFile = vi.fn(async () => {});
    const service = new PipelineService(db, createNullLogger(), {exec,ssh,execute,uploadFile} as unknown as ExecutionService);
    let receiverPin = f.receiver.pin;
    const nodes = [f.source,f.receiver].map(n => ({id:n.id,host:n.host,isLocal:false,sshPort:22,daemonPort:2310,sshUser:'admin',createdAt:'2000-01-01T00:00:00Z'}));
    service.configure({ getNode: id => nodes.find(n=>n.id===id) as never,
      nodeToSshTarget: async n => ({host:n.host,port:n.sshPort,username:n.sshUser,expectedHostFingerprint:n.id===f.source.id?f.source.pin:receiverPin}) });
    const rpc = new PipelineRpcService(service, {validateSession:async()=>({id:'owner',role:'admin'}) as never}, {record:async()=>{}} as never);
    async function complete(def: PipelineDef) {
      const pipeline = await runWithAuth(actor(), () => rpc.createPipeline(def));
      const prepared = await runWithAuth(actor(), () => rpc.prepareRun({id:pipeline.id,runId:randomUUID(),expectedRevision:pipeline.revision}));
      await runWithAuth(actor(), () => rpc.startRun({runId:prepared.id,expectedDigest:prepared.review!.digest}));
      await vi.waitFor(async () => expect((await runWithAuth(actor(), () => rpc.getRunStatus({runId:prepared.id})))?.status).toBe('success'));
      return { pipeline, request:{project:f.seed.project,stack:f.seed.stack,verifyRunId:prepared.id} };
    }
    try {
      const { pipeline,request } = await complete(f.graph);
      await expect(runWithAuth(actor('viewer'),()=>rpc.inspectPhysicalRestore(request))).rejects.toThrow();
      const read = () => runWithAuth(actor(),()=>rpc.inspectPhysicalRestore(request));
      const proof = await read();
      expect(proof).toMatchObject({kind:'physical-service-data', sourceStop:f.cold.stop, seed:f.seed.id, definitionRevision:pipeline.revision,
        postgres:{postgres:{systemIdentifier:'123',controlSha256:observed.controls.postgres}},minio:{formatSha256:observed.controls.minio}});
      expect(proof.volumes.map(v=>v.tag)).toEqual(tags);
      expect(ssh).toHaveBeenCalledTimes(2);
      expect(exec).not.toHaveBeenCalled();
      expect(reads).toHaveBeenCalledTimes(6);
      const facts = { protocol: 1 as const, ...request, sourceRevision: 3, ownerDigest: sha256('owner'), operationId: randomUUID(), release: 'next',
        prepared: sha256('approved-next'), manifestSha256: sha256('manifest'), selectionDigest: sha256('serving-release'),
        receiver: proof.receiver, sourceStop: proof.sourceStop, seed: proof.seed, proofDigest: proof.proofDigest, logicalBytes: 40,
        volumes: proof.volumes.filter(v => ['postgres-data','minio-data'].includes(v.tag)) };
      const plan: RehearsalCopyPlan = { ...facts, digest: canonicalHash(facts) };
      const receipt = { operationId: plan.operationId, review: plan.digest, copies: plan.volumes.map((v,i) =>
        ({tag:v.tag,device:'33',inode:String(123+i),generation:sha256(v.tag)})) };
      const remoteCopy = (response: typeof receipt, previous: typeof receipt | null = null) => ssh.mockImplementationOnce(async (target, cmd, options) => {
        expect(target).toMatchObject({host:f.receiver.host,expectedHostFingerprint:f.receiver.pin});
        expect(cmd).toContain('/usr/bin/python3 -I -c ');
        const wire = JSON.parse(options.stdin);
        expect(wire.plan).toEqual(plan);
        expect(wire.previous).toEqual(previous);
        expect(wire.probe.seed).toBe(f.seed.id);
        expect(wire.worker).toContain('def prepare_working_pair(');
        expect(wire.observer).toContain('with mod["ch"].lock(state / "operation.lock")');
        return {exitCode:0,stdout:JSON.stringify(response),stderr:'',duration:1};
      });
      remoteCopy(receipt);
      await expect(service.prepareRehearsalCopy(plan)).resolves.toEqual(receipt);
      remoteCopy(receipt, receipt);
      await expect(service.prepareRehearsalCopy(plan, receipt)).resolves.toEqual(receipt);
      const trialFacts = { protocol:1 as const, copy:plan, receipt, app:'ledger', producerApp:'ledger', database:'ledger',
        producerManifest:sha256('producer'), archiveSha256:sha256('archive'), archiveBytes:100, closureSha256:sha256('closure'), nodeOptions:'',
        program:{path:'dist/database/migrate.js',sha256:sha256('program'),sourceSha256:sha256('source')}, names:['002_capture'],added:['002_capture'],
        target:{platform:'linux',arch:'x64',node:'v24.10.0',abi:'137',executableSha256:sha256('node'),libc:'2.39'} };
      const trialPlan = {...trialFacts,digest:canonicalHash(trialFacts)}, runtime = vi.fn(async () => 12345);
      const trialReply = (phase:string, state:string, values:Record<string,unknown>={}) => ssh.mockImplementationOnce(async (target,cmd,options) => {
        expect(target).toMatchObject({host:f.receiver.host,expectedHostFingerprint:f.receiver.pin});
        expect(cmd).toContain('TRIAL_RESERVATION_CHANGED');
        const wire = JSON.parse(options.stdin);
        expect(wire).toMatchObject({phase,plan:trialPlan,probe:{seed:f.seed.id}});
        expect(wire.nodePid).toBe(phase==='run'?12345:undefined);
        expect(wire.sandbox).toContain('CANDIDATE_PREFLIGHT_FAILED');
        return {exitCode:0,stdout:JSON.stringify({review:trialPlan.digest,state,...values}),stderr:'',duration:1};
      });
      const trial = (readOnly:boolean) => service.rehearsePrivateMigrations(trialPlan,'/controller/ledger.tar.gz',readOnly,runtime);
      trialReply('status','available');
      await expect(trial(true)).resolves.toMatchObject({state:'awaiting-confirmation',writeAdmission:'withheld'});
      expect(uploadFile).not.toHaveBeenCalled();
      const registry = [{name:'002_capture',checksum:sha256('002')}];
      const journal = {operationId:plan.operationId,review:trialPlan.digest,registry,before:[],after:registry.map(row=>({...row,executedAt:'2026-11-24T01:02:03.123456Z'})),
        generations:{postgres:sha256('new generation'),minio:receipt.copies[1]!.generation}};
      trialReply('reserve','staging'); trialReply('run','verified',{receipt:journal});
      await expect(trial(false)).resolves.toMatchObject({state:'verified',writeAdmission:'withheld',receipt:journal});
      expect(uploadFile).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({host:f.receiver.host,expectedHostFingerprint:f.receiver.pin}),
        '/controller/ledger.tar.gz','/var/lib/omnitron-release-rehearsals/'+plan.operationId+'/candidate-'+trialPlan.archiveSha256+'.tar.gz');
      trialReply('status','verified',{receipt:{...journal,after:[]}});
      await expect(trial(true)).rejects.toThrow('Incomplete private migration receipt');
      expect(runtime).toHaveBeenCalledTimes(1);
      trialReply('reserve','unconfirmed',{reason:'NATIVE_COMPLETION_UNCONFIRMED'});
      await expect(trial(false)).resolves.toMatchObject({state:'unconfirmed',writeAdmission:'withheld'});
      expect(uploadFile).toHaveBeenCalledTimes(1);
      remoteCopy({...receipt,copies:receipt.copies.map((v,i)=>({...v,...plan.volumes[i]!.receiver}))});
      await expect(service.prepareRehearsalCopy(plan)).rejects.toThrow('distinct private roots');
      const attempts = ssh.mock.calls.length;
      await expect(service.prepareRehearsalCopy({...plan, release:'other'})).rejects.toThrow('original verified graph');
      const changedFacts = {...facts,volumes:facts.volumes.map(v=>({...v,metadataSha256:sha256('other')}))};
      await expect(service.prepareRehearsalCopy({...changedFacts,digest:canonicalHash(changedFacts)})).rejects.toThrow('original verified graph');
      receiverPin = 'SHA256:'+'X'.repeat(43);
      await expect(service.prepareRehearsalCopy(plan)).rejects.toThrow('host key');
      expect(ssh).toHaveBeenCalledTimes(attempts);
      receiverPin = f.receiver.pin;
      await db.updateTable('pipelines').set({name:'new-current-graph',steps:JSON.stringify([{name:'different',run:'true'}])})
        .where('id','=',pipeline.id).execute();
      expect((await read()).proofDigest).toBe(proof.proofDigest);
      await expect(runWithAuth(actor(),()=>rpc.inspectPhysicalRestore({...request,stack:'other'}))).rejects.toThrow('scope');
      await expect(runWithAuth(actor(),()=>rpc.inspectPhysicalRestore({...request,proof} as typeof request))).rejects.toThrow('native verify');
      targetControls = {...observed.controls,minio:sha256('other format')};
      await expect(read()).rejects.toThrow('fingerprints differ');
      targetControls = observed.controls;
      receiverPin = 'SHA256:'+'C'.repeat(43);
      await expect(read()).rejects.toThrow('host key');
      receiverPin = f.receiver.pin;
      reads.mockReturnValueOnce({ nodeId: f.receiver.id, fingerprint: f.source.pin });
      await expect(read()).rejects.toThrow('source stop');
      const previous = ssh.mock.calls.length;
      const repacked = structuredClone(f.graph);
      const original = repacked.steps[3]!.run!;
      const command = / '([a-f0-9]{64})' '([A-Za-z0-9+/]+=*)' 'verify' /.exec(original)!;
      const repack = (change: boolean) => {
        const program = gunzipSync(Buffer.from(command[2]!, 'base64')).toString().replace(
          /(['"])(H4sI[A-Za-z0-9+/]*={0,2})\1/g, (_m, quote: string, encoded: string) => {
            const inner = gunzipSync(Buffer.from(encoded, 'base64'));
            return quote + gzipSync(change ? Buffer.concat([inner,Buffer.from('\n# different module\n')]) : inner, {level:9}).toString('base64') + quote;
          });
        expect(sha256(program)).not.toBe(command[1]);
        return original.replace(command[0], " '" + sha256(program) + "' '" + gzipSync(program, {level:9}).toString('base64') + "' 'verify' ");
      };
      repacked.steps[3] = {...repacked.steps[3]!,run:repack(false)} as PipelineDef['steps'][number];
      const equivalent = await complete(repacked);
      expect((await runWithAuth(actor(),()=>rpc.inspectPhysicalRestore(equivalent.request))).seed).toBe(f.seed.id);
      await db.updateTable('pipelines').set({name:'other-compression'}).where('id','=',equivalent.pipeline.id).execute();
      repacked.steps[3] = {...repacked.steps[3]!,run:repack(true)} as PipelineDef['steps'][number];
      const unqualified = await complete(repacked);
      await expect(runWithAuth(actor(),()=>rpc.inspectPhysicalRestore(unqualified.request))).rejects.toThrow('verification worker');
      await db.updateTable('pipelines').set({name:'unknown-module'}).where('id','=',unqualified.pipeline.id).execute();
      const changed = structuredClone(f.graph);
      changed.steps[3] = {...changed.steps[3]!,run:'true'} as PipelineDef['steps'][number];
      const other = await complete(changed);
      await expect(runWithAuth(actor(),()=>rpc.inspectPhysicalRestore(other.request))).rejects.toThrow('verification worker');
      expect(ssh).toHaveBeenCalledTimes(previous + 2);
    } finally { await service.dispose(); await db.destroy(); }
  });
});
