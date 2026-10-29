import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { PipelineService } from '../../src/services/pipeline.service.js';
import { databaseOfItsOwn, type OwnDatabase } from './a-database-of-its-own.js';
import { requiresTestPostgres } from './requires-test-postgres.js';

const postgres = await requiresTestPostgres(
  process.env.TEST_DATABASE_URL ?? 'postgresql://test:test@localhost:15432/test'
);
const logger = { info() {}, error() {}, warn() {}, debug() {} } as never;
describe.skipIf(!postgres.ok)('durable Xec automation lifecycle', () => {
  let own: OwnDatabase, service: PipelineService, dir: string;
  beforeAll(async () => {
    own = await databaseOfItsOwn(postgres.url, `pipeline_lifecycle_${process.pid}`);
    service = new PipelineService(own.db, logger);
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
    await service.updatePipeline(def.id, { name: 'review', steps: [{ name: 'one', run: 'echo changed' }] });
    await expect(service.executePipeline(def.id, {}, 'reviewer', def.revision)).rejects.toThrow('changed after review');
    expect(await service.listRuns(def.id)).toEqual([]);
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
    const restarted = new PipelineService(own.db, logger);
    await restarted.initialize();
    expect(await restarted.getRunStatus('ab224566-899c-49d4-b7ec-087563cf13f7')).toMatchObject({
      status: 'interrupted',
      steps: [{ status: 'interrupted' }],
    });
    await restarted.dispose();
  });
});
