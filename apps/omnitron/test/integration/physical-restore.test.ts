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
      expect(opts.stdin).toContain('def inspect(side, proof)');
      const payload = JSON.parse(Buffer.from(command.split(' ').at(-1)!, 'base64').toString()) as {seed:string, cold:string};
      expect(payload.seed).toBe(f.seed.id);
      expect(payload.cold).toBe(canonicalHash(f.cold));
      const pin = target.host === f.source.host ? f.source : f.receiver;
      expect(target.expectedHostFingerprint).toBe(pin.pin);
      return {exitCode:0,stdout:JSON.stringify({...observed,controls: target.host === f.source.host ? observed.controls : targetControls}),stderr:'',duration:1};
    });
    const execute = vi.fn(async (command: Command) => ({ exitCode:0, stdout:command.adapter === 'ssh'
      ? JSON.stringify(f.result, null, 1) : 'checked', stderr:'',duration:1 }));
    const service = new PipelineService(db, createNullLogger(), {exec,ssh,execute} as unknown as ExecutionService);
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
      expect(exec).toHaveBeenCalledTimes(4);
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
      exec.mockResolvedValueOnce({stdout:'unknown',exitCode:1,stderr:'',duration:1});
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
