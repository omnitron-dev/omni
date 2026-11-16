import { randomUUID } from 'node:crypto';
import { testExecution } from '../fixtures/execution.js';
import { TEST_POSTGRES_URL } from '@omnitron-dev/testing/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const postgres = await requiresTestPostgres(
  TEST_POSTGRES_URL
);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
describe.skipIf(!postgres.ok)('durable Xec automation lifecycle', () => {
  let own: OwnDatabase, service: PipelineService, dir: string;
  beforeAll(async () => {
    own = await databaseOfItsOwn(postgres.url, `pipeline_lifecycle_${process.pid}`);
    service = new PipelineService(own.db, logger, testExecution);
    await service.initialize();
    dir = await mkdtemp(join(tmpdir(), 'omnitron-pipeline-'));
  });
  afterAll(async () => {
    await service?.dispose();
    await own?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });
  const terminal = async (id: string) => {
    for (let i = 0; i < 200; i++) {
      const run = await service.getRunStatus(id);
      if (run && !['running', 'pending', 'cancelling'].includes(run.status)) return run;
      await delay(25);
    }
    throw Error('Run did not reach a terminal state');
  };
  it('claims one stable command through concurrent PostgreSQL transactions', async () => {
    const witness = join(dir, 'deduplicated.txt');
    const def = await service.createPipeline({ name: 'stable-command', steps: [{ name: 'effect', kind: 'xec', cwd: dir,
      run: "import fs from 'node:fs'; fs.appendFileSync(String(params.witness), 'once\\n');" }] });
    const runId = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      service.executePipeline(def.id, { witness }, 'reviewer', def.revision, runId)));
    expect(results.every(run => run.id === runId)).toBe(true);
    expect((await terminal(runId)).status).toBe('success');
    expect(await readFile(witness, 'utf8')).toBe('once\n');
    expect(await service.listRuns(def.id)).toHaveLength(1);
    const other = new PipelineService(own.db, logger, testExecution);
    await other.initialize();
    expect((await other.executePipeline(def.id, { witness }, 'reviewer', def.revision, runId)).status).toBe('success');
    expect(await readFile(witness, 'utf8')).toBe('once\n');
    await other.dispose();
  });
  it('atomically reconciles and resumes a JSONB checkpoint without redispatching a deployment', async () => {
    const target = { project: 'remote', stack: 'test', releaseId: 'sealed', manifestSha256: 'a'.repeat(64), review: 'b'.repeat(64) };
    let dispatches = 0;
    service.configure({} as never, undefined, { assertLifecycle() {}, projects: {
      resolvePipelineRelease: async () => { throw Error('Unused compiled entry'); },
      resolvePipelineDeployment: async () => ({ evidence: { target, scope: { project: 'remote', stack: 'test', registeredAt: 'fixture' },
        expected: [{ node: 'node', app: 'api', releaseId: 'sealed', manifestSha256: 'a'.repeat(64), artifactSha256: 'c'.repeat(64) }], state: 'prepared' },
        execute: async () => { dispatches++; throw Error('Lost acknowledgement'); } }),
      inspectPipelineDeployment: async () => ({ basis: 'observed-target', confirmed: true, observedAt: new Date().toISOString(),
        apps: [{ node: 'node', app: 'api', launchId: 'native', matches: true }] }),
    } });
    const def = await service.createPipeline({ name: 'jsonb-recovery', steps: [{ name: 'deploy', kind: 'deploy', target },
      { name: 'after', run: 'echo continued', dependsOn: ['deploy'] }] });
    const failed = await terminal((await service.executePipeline(def.id, {}, 'operator', def.revision)).id);
    expect(failed.status).toBe('failed');
    const observed = await service.reconcileRun(failed.id);
    expect(observed.recovery!.blocked).toEqual([]);
    const request = { runId: failed.id, expectedDigest: observed.recovery!.digest };
    await service.resumeRun(request, 'operator');
    expect((await terminal(failed.id)).status).toBe('success');
    expect((await service.resumeRun(request, 'operator')).status).toBe('success');
    expect(dispatches).toBe(1);
  });
  it('journals a real TypeScript script and redacts parameters from persisted output', async () => {
    const def = await service.createPipeline({
      name: 'inspect',
      steps: [
        {
          name: 'one',
          kind: 'xec',
          cwd: dir,
          run: 'const value: string = params.value; console.log(value); console.error("warning");',
        },
      ],
    });
    const run = await service.executePipeline(def.id, { value: 'private-input' }, 'account-id', def.revision);
    const result = await terminal(run.id);
    expect(result).toMatchObject({ status: 'success', triggeredBy: 'account-id', params: { value: '[provided]' } });
    expect(result.steps[0]).toMatchObject({ status: 'success', output: '***\n', stderr: 'warning\n', attempts: 1 });
    expect(result.steps[0]?.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    const history = await service.listRuns(def.id);
    expect(history[0]).toMatchObject({ id: run.id, status: 'success' });
    expect(history[0]).not.toHaveProperty('steps');
    expect(history[0]).not.toHaveProperty('params');
  });
  it('rejects edits made after review, before inserting or running a job', async () => {
    const def = await service.createPipeline({ name: 'review', steps: [{ name: 'one', run: 'echo first' }] });
    await service.updatePipeline(def.id, { name: 'review', steps: [{ name: 'one', run: 'echo changed' }] }, def.revision);
    await expect(service.executePipeline(def.id, {}, 'reviewer', def.revision)).rejects.toThrow('changed after review');
    expect(await service.listRuns(def.id)).toEqual([]);
  });
  it('allows only one concurrent editor to replace a reviewed definition', async () => {
    const def = await service.createPipeline({ name: 'concurrent', steps: [{ name: 'one', run: 'echo first' }] });
    const other = new PipelineService(own.db, logger, testExecution);
    const results = await Promise.allSettled([service, other].map((editor, index) =>
      editor.updatePipeline(def.id, { name: 'concurrent', steps: [{ name: 'one', run: `echo edit-${index}` }] }, def.revision)));
    const success = results.filter((result) => result.status === 'fulfilled');
    const failures = results.filter((result) => result.status === 'rejected');
    expect(success).toHaveLength(1);
    expect(failures).toHaveLength(1);
    expect(failures[0]!.reason.message).toContain('changed after review');
    expect(await service.getPipeline(def.id)).toEqual(success[0]!.value);
    expect(success[0]!.value).toMatchObject({ id: def.id, conditionalUpdates: true });
    expect(success[0]!.value.revision).not.toBe(def.revision);
    await other.dispose();
  });
  it('retains completed run history and invalidates a revision even for an identical save', async () => {
    const input = { name: 'keep-history', steps: [{ name: 'one', run: 'echo ready' }] };
    const def = await service.createPipeline(input);
    const run = await service.executePipeline(def.id, {}, 'editor', def.revision);
    await terminal(run.id);
    const edited = await service.updatePipeline(def.id, input, def.revision);
    expect(edited.id).toBe(def.id);
    expect(edited.revision).not.toBe(def.revision);
    expect((await service.getRunStatus(run.id))?.status).toBe('success');
    await expect(service.updatePipeline(def.id, input, def.revision)).rejects.toThrow('changed after review');
    await expect(service.updatePipeline(def.id, input, '')).rejects.toThrow('Review');
  });
  it('waits for local cancellation, and prevents a dependent step from running', async () => {
    const pidPath = join(dir, 'pid'),
      later = join(dir, 'later');
    const def = await service.createPipeline({
      name: 'cancel',
      steps: [
        {
          name: 'one',
          kind: 'xec',
          cwd: dir,
          run: `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid)); await new Promise(r => setTimeout(r, 20000));`,
        },
        {
          name: 'two',
          kind: 'xec',
          cwd: dir,
          dependsOn: ['one'],
          run: `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(later)}, 'unexpected');`,
        },
      ],
    });
    const run = await service.executePipeline(def.id);
    let pid = 0;
    for (let i = 0; i < 100 && !pid; i++) {
      pid = Number(await readFile(pidPath, 'utf8').catch(() => '0'));
      await delay(20);
    }
    expect(pid).toBeGreaterThan(0);
    await expect(service.deletePipeline(def.id)).rejects.toThrow('active runs');
    await service.cancelRun(run.id);
    expect((await service.getRunStatus(run.id))?.status).toBe('cancelled');
    expect(() => process.kill(pid, 0)).toThrow();
    await expect(access(later)).rejects.toThrow();
    await service.cancelRun(run.id); // terminal cancellation is idempotent
  });
  it('does not execute a partially valid graph', async () => {
    await expect(
      service.createPipeline({ name: 'invalid', steps: [{ name: 'one', run: 'echo first', dependsOn: ['missing'] }] })
    ).rejects.toThrow();
  });
  it('marks unfinished jobs interrupted on restart instead of replaying effects', async () => {
    const def = await service.createPipeline({ name: 'interrupted', steps: [{ name: 'one', run: 'echo first' }] });
    await own.db
      .insertInto('pipeline_runs')
      .values({
        id: 'ab224566-899c-49d4-b7ec-087563cf13f7',
        pipelineId: def.id,
        status: 'running',
        steps: JSON.stringify([{ name: 'one', status: 'running', duration: 0 }]),
        params: '{}',
        triggeredBy: 'test',
        startedAt: new Date(),
        completedAt: null,
      })
      .execute();
    const restarted = new PipelineService(own.db, logger, testExecution);
    await restarted.initialize();
    expect(await restarted.getRunStatus('ab224566-899c-49d4-b7ec-087563cf13f7')).toMatchObject({
      status: 'interrupted',
      steps: [{ status: 'interrupted' }],
    });
    await restarted.dispose();
  });
});

// Uses its own database; the running control-plane database is never opened.
describe.skipIf(!postgres.ok)('pipeline admission expansion compatibility', () => {
  it('keeps the old writer valid and retains recovery data while the old runtime is selected', async () => {
    const own = await databaseOfItsOwn(postgres.url, `pipeline_expand_${process.pid}`);
    try {
      const { sql } = await import('kysely');
      const { MASTER_SCHEMA_EXPANSIONS } = await import('../../src/database/schema-expansion-policy.js');
      const { migration } = await import('../../src/database/migrations/017_pipeline_admission.js');
      expect(MASTER_SCHEMA_EXPANSIONS.find(policy => policy.name === migration.name)?.checksum).toBe(migration.checksum);
      const id = randomUUID(), runId = randomUUID();
      await own.db.insertInto('pipelines').values({ id, name: 'old-writer', description: null, steps: '[]', triggers: '[]', createdAt: new Date(), updatedAt: new Date() }).execute();
      await own.db.insertInto('pipeline_runs').values({ id: runId, pipelineId: id, status: 'interrupted', steps: '[]', startedAt: new Date(), completedAt: null, triggeredBy: 'old-runtime', params: '{}' }).execute();
      expect((await own.db.selectFrom('pipeline_runs').select('admission').where('id', '=', runId).executeTakeFirstOrThrow()).admission).toBeNull();
      await own.db.updateTable('pipeline_runs').set({ admission: JSON.stringify({ privateReceipt: 'retained' }) }).where('id', '=', runId).execute();
      // Old UPDATE statements do not name the new nullable column.
      await sql`UPDATE pipeline_runs SET status = 'interrupted' WHERE id = ${runId}`.execute(own.db);
      expect((await own.db.selectFrom('pipeline_runs').select('admission').where('id', '=', runId).executeTakeFirstOrThrow()).admission).toEqual({ privateReceipt: 'retained' });
    } finally { await own.drop(); }
  });
});
