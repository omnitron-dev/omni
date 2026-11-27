import { execFile } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmod, mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, it, expect, vi } from 'vitest';
import { createNullLogger } from '@omnitron-dev/titan/module/logger';
import type { ExecutionService } from '../../src/execution/execution.service.js';
import { stableJson } from '../../src/shared/canonical-json.js';
import type { PipelineDef } from '../../src/shared/dto/pipelines.js';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { recoveryPolicyPath, recoveryProbePath, readRecoveryQualificationProbe, readRecoveryStaticIndex,
  type RecoveryQualificationExpected } from '../../src/services/recovery-qualification.js';
import { createPipelineTestDatabase } from '../fixtures/pipeline-database.js';
import { loadRelease } from '../../src/release/load.js';
import { stageRecoveryInputs } from '../../src/services/recovery-inputs.js';
import { readRecoveryQualificationRelease } from '../../src/services/recovery-qualification.js';

const exec = promisify(execFile);
const hex = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture(): RecoveryQualificationExpected {
  const release = (id: string) => ({ id, commit: hex(id).slice(0, 40), tree: hex(id + 'tree').slice(0, 40),
    manifestSha256: hex(id + 'manifest'), artifacts: { ledger: hex(id + 'ledger') }, staticsIndexSha256: hex(id + 'statics') });
  return { project: 'fixture', stack: 'prod', nodeId: 'live', incumbent: release('previous'), candidate: release('candidate'),
    recovery: release('recovery'), addedMigrations: ['migrations/219.ts', 'migrations/220.ts'],
    probe: { commit: hex('probe').slice(0, 40), sha256: hex('probe'), image: 'sha256:' + hex('image'), recordSets: ['award'] } };
}
describe('native recovery qualification', () => {
  it('runs the isolated worker regression with separately reopened synthetic SQL data and immutable inputs', async () => {
    const file = fileURLToPath(new URL('../runtime/recovery-qualification.py', import.meta.url));
    const result = await exec('python3', ['-I', '-B', file]);
    expect(result.stderr).toContain('OK');
  });

  it('binds an admitted run to its pinned graph, host fingerprint and every release byte identity', async () => {
    const spec = fixture(), db = createPipelineTestDatabase();
    const phases = ['full/baseline', 'full/candidate-write', 'full/recovery-read', 'full/recovery-write', 'full/recovery-replay',
      'full/recovery-restart', 'partial/baseline', 'partial/candidate-partial', 'partial/recovery-complete', 'partial/recovery-repeat'];
    // A test execution adapter supplies the simulated receiver reply. Real checks inside the worker
    // are exercised separately. Identical stdout from a substituted command must never open admission.
    const reply = JSON.stringify({ protocol: 1, challenge: 'f'.repeat(48), phases: phases.map(phase => ({ phase, sha256: hex(phase) })),
      inputs: hex(stableJson(spec)) }, null, 2);
    const execute = vi.fn(async () => ({ exitCode: 0, stdout: reply, stderr: '', duration: 1 }));
    const service = new PipelineService(db, createNullLogger(), { execute } as unknown as ExecutionService);
    const nodes = ['live', 'qa'].map((id, i) => ({ id, isLocal: false, host: '192.0.2.' + (i + 1),
      sshPort: 22, sshUser: 'qa', createdAt: '2020-01-01T00:00:00Z' }));
    let qaPin = 'B';
    service.configure({ getNode: id => nodes.find(node => node.id === id) as never, nodeToSshTarget: async node =>
      ({ host: node.host, port: node.sshPort, username: node.sshUser, expectedHostFingerprint: 'SHA256:' + (node.id === 'qa' ? qaPin : 'A').repeat(43) }) });
    async function complete(def: PipelineDef) {
      const registered = await service.createPipeline(def);
      const prepared = await service.prepareRun({ id: registered.id, runId: randomUUID(), expectedRevision: registered.revision }, 'owner');
      await service.startRun({ runId: prepared.id, expectedDigest: prepared.review!.digest }, 'owner');
      await vi.waitFor(async () => expect((await service.getRunStatus(prepared.id))?.status).toBe('success'));
      return prepared.id;
    }
    try {
      const def = await service.recoveryQualificationDefinition(spec, 'qa');
      const run = await complete(def);
      const evidence = await service.inspectRecoveryQualification(run, spec);
      expect(evidence).toMatch(/^[a-f0-9]{64}$/);
      expect(await service.inspectRecoveryQualification(run, spec)).toBe(evidence);
      await expect(service.inspectRecoveryQualification(randomUUID(), spec)).rejects.toThrow('approved');
      for (const changed of [
        { ...spec, candidate: { ...spec.candidate, artifacts: { ledger: hex('swapped') } } },
        { ...spec, recovery: { ...spec.recovery, staticsIndexSha256: hex('other-portal') } },
        { ...spec, addedMigrations: [...spec.addedMigrations].reverse() },
      ]) await expect(service.inspectRecoveryQualification(run, changed)).rejects.toThrow('approved run');
      await expect(service.recoveryQualificationDefinition(spec, 'live')).rejects.toThrow('separate enrolled');
      await expect(service.recoveryQualificationDefinition({ ...spec,
        recovery: { ...spec.recovery, artifacts: { ...spec.candidate.artifacts } } }, 'qa')).rejects.toThrow('identical application');
      qaPin = 'C';
      await expect(service.inspectRecoveryQualification(run, spec)).rejects.toThrow('approved run');
      qaPin = 'B';
      const wrong = await complete({ ...def, name: 'substituted', steps: [{ ...def.steps[0]!, run: 'true' } as PipelineDef['steps'][number]] });
      await expect(service.inspectRecoveryQualification(wrong, spec)).rejects.toThrow('approved run');
      qaPin = 'A';
      await expect(service.inspectRecoveryQualification(run, spec)).rejects.toThrow('shares the production endpoint');
    } finally { await service.dispose(); await db.destroy(); }
  });

  it('binds immutable probe-only descendants even in a detached checkout; rejects unrelated changes and symlinks', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'omni-probe-source-'));
    const git = async (...args: string[]) => (await exec('git', ['-c', 'user.name=Test', '-c', 'user.email=test@invalid', ...args], { cwd: root })).stdout.trim();
    try {
      await git('init', '-q');
      await git('commit', '--allow-empty', '-qm', 'candidate');
      const candidate = await git('rev-parse', 'HEAD');
      await git('checkout', '--detach', candidate);
      await mkdir(path.join(root, '.omnitron')); await mkdir(path.join(root, 'scripts'));
      await writeFile(path.join(root, recoveryPolicyPath), JSON.stringify({ protocol: 1, image: 'sha256:' + hex('image'), recordSets: ['award'] }));
      await writeFile(path.join(root, recoveryProbePath), 'print("probe")');
      await git('add', '.'); await git('commit', '-qm', 'reviewed probe');
      const reviewed = await git('rev-parse', 'HEAD');
      await writeFile(path.join(root, recoveryProbePath), 'working tree is deliberately different');
      const probe = await readRecoveryQualificationProbe(root, candidate, reviewed);
      expect(probe.sha256).toBe(hex('print("probe")'));
      const store = path.join(await realpath(root), 'releases'), spec = fixture();
      spec.probe = probe;
      for (const role of ['incumbent', 'candidate', 'recovery'] as const) {
        const id = spec[role].id, dir = path.join(store, id);
        await mkdir(path.join(dir, 'artifacts'), { recursive: true });
        await mkdir(path.join(dir, 'statics'));
        await writeFile(path.join(dir, 'statics/index.html'), role);
        await writeFile(path.join(dir, 'artifacts/ledger-1.tar.gz'), role);
        const source = { repo: '/test/fixture', commit: candidate, onRemote: true };
        const manifest = { id, project: source, omni: source, artifacts: [{ app: 'ledger', version: '1', bytes: role.length, sha256: hex(role) }],
          statics: { stack: 'prod', dir: 'public', files: 1, bytes: role.length }, gates: [], builtWith: { omnitron: '1.0.0', packages: [] } };
        await writeFile(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
        spec[role] = await readRecoveryQualificationRelease(await loadRelease(id, store), root);
      }
      const file = path.join(store, 'pipeline.json');
      await writeFile(file, JSON.stringify({ steps: [{ name: 'qualify-recovery', kind: 'shell',
        run: 'fixture ' + Buffer.from(stableJson(spec)).toString('base64') }] }));
      const home = path.join(await realpath(root), 'qa-home'); await mkdir(home);
      vi.stubEnv('HOME', home);
      try {
        const stage = await stageRecoveryInputs(file, store, root);
        expect(await stageRecoveryInputs(file, store, root)).toEqual(stage);
        const blob = path.join(stage.root, hex('recovery'));
        expect(await readFile(blob, 'utf8')).toBe('recovery');
        await chmod(blob, 0o600); await writeFile(blob, 'tampered');
        await expect(stageRecoveryInputs(file, store, root)).rejects.toThrow('damaged');
      } finally { vi.unstubAllEnvs(); }
      await writeFile(path.join(root, 'app.js'), 'changed'); await git('add', 'app.js'); await git('commit', '-qm', 'other change');
      await expect(readRecoveryQualificationProbe(root, candidate, await git('rev-parse', 'HEAD'))).rejects.toThrow('other project files');
      const statics = path.join(root, 'public'); await mkdir(statics); await writeFile(path.join(statics, 'index.html'), 'hi');
      expect((await readRecoveryStaticIndex(statics)).index['index.html']).toEqual({ bytes: 2, sha256: hex('hi') });
      await symlink(path.join(root, 'app.js'), path.join(statics, 'linked'));
      await expect(readRecoveryStaticIndex(statics)).rejects.toThrow('symbolic link');
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
