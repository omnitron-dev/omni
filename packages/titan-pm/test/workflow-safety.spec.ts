import 'reflect-metadata';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProcessWorkflow, WorkflowStageUncertainError } from '../src/process-workflow.js';
import { Workflow, Stage, Compensate, WORKFLOW_METADATA_KEY } from '../src/decorators.js';
import type { IWorkflowContext, IWorkflowStage } from '../src/types.js';
const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn(), error: vi.fn() };
function workflow(stages: IWorkflowStage[]) {
  class Fixture {}
  Reflect.defineMetadata(
    WORKFLOW_METADATA_KEY,
    { stages: new Map(stages.map((stage) => [stage.name, stage])) },
    Fixture
  );
  const engine = new ProcessWorkflow({} as never, Fixture, logger as never);
  const instance = engine.create() as { getContext(): IWorkflowContext };
  return { engine, context: () => instance.getContext() };
}
afterEach(() => vi.useRealTimers());

describe('workflow safety boundaries', () => {
  it('rejects missing prerequisites before invoking any handler', async () => {
    const handler = vi.fn();
    const { engine } = workflow([{ name: 'deploy', handler, dependsOn: 'approval' }]);
    await expect(engine.run()).rejects.toMatchObject({ code: 'missing-dependency' });
    expect(handler).not.toHaveBeenCalled();
  });
  it('settles parallel stages before compensation and records both completed siblings', async () => {
    let finish!: () => void;
    const events: string[] = [];
    const { engine } = workflow([
      {
        name: 'prepare',
        handler: async () => {
          events.push('prepared');
        },
        compensate: async () => {
          events.push('undo-prepare');
        },
      },
      {
        name: 'slow',
        dependsOn: 'prepare',
        handler: () =>
          new Promise<void>((resolve) => {
            finish = () => {
              events.push('slow-done');
              resolve();
            };
          }),
        compensate: async () => {
          events.push('undo-slow');
        },
      },
      {
        name: 'fail',
        dependsOn: 'prepare',
        handler: async () => {
          throw new Error('failed');
        },
      },
    ]);
    const result = engine.run().catch((error) => error);
    await vi.waitFor(() => expect(finish).toBeTypeOf('function'));
    expect(events).toEqual(['prepared']);
    finish();
    expect(await result).toMatchObject({ message: 'failed' });
    expect(events).toEqual(['prepared', 'slow-done', 'undo-slow', 'undo-prepare']);
  });
  it('does not retry or compensate a timed-out handler which can still perform effects', async () => {
    vi.useFakeTimers();
    const compensation = vi.fn();
    let finish!: () => void;
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { engine, context } = workflow([
      { name: 'prepare', handler: async () => {}, compensate: compensation },
      { name: 'deploy', dependsOn: 'prepare', handler, timeout: 50, retries: 2 },
    ]);
    const result = engine.run().catch((error) => error);
    await vi.advanceTimersByTimeAsync(50);
    const error = await result;
    expect(error).toBeInstanceOf(WorkflowStageUncertainError);
    expect(context().stages.get('deploy')?.status).toBe('unknown');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(compensation).not.toHaveBeenCalled();
    finish();
    await expect(engine.run()).rejects.toBe(error);
    expect(handler).toHaveBeenCalledTimes(1);
  });
  it('rejects concurrent reuse and clears prior results before a later run', async () => {
    let finish!: () => void;
    const rollback = vi.fn();
    const handler = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        })
    );
    const { engine, context } = workflow([{ name: 'work', handler, compensate: rollback }]);
    const first = engine.run();
    const id = context().id;
    await expect(engine.run()).rejects.toThrow(/already running/);
    finish();
    await first;
    handler.mockRejectedValueOnce(new Error('second failed'));
    await expect(engine.run()).rejects.toThrow('second failed');
    expect(context().id).not.toBe(id);
    expect(rollback).not.toHaveBeenCalled();
  });
  it('surfaces compensation failures and blocks unsafe instance reuse', async () => {
    const rollback = new Error('rollback unavailable');
    const failure = new Error('deployment failed');
    const { engine, context } = workflow([
      {
        name: 'prepare',
        handler: async () => {},
        compensate: async () => {
          throw rollback;
        },
      },
      {
        name: 'deploy',
        dependsOn: 'prepare',
        handler: async () => {
          throw failure;
        },
      },
    ]);
    const error = await engine.run().catch((error) => error);
    expect(error).toBeInstanceOf(AggregateError);
    expect(error.errors).toEqual([failure, rollback]);
    expect(context().stages.get('prepare')?.compensation).toEqual({ status: 'failed', error: rollback });
    await expect(engine.run()).rejects.toBe(error);
  });
  it('rejects invalid timeout/retry policies before doing work', async () => {
    for (const options of [
      { timeout: Infinity },
      { timeout: -1 },
      { timeout: 3_000_000_000 },
      { retries: NaN },
      { retries: -1 },
    ]) {
      const handler = vi.fn();
      await expect(workflow([{ name: 'work', handler, ...options }]).engine.run()).rejects.toThrow(/Invalid/);
      expect(handler).not.toHaveBeenCalled();
    }
  });
  it('keeps compensations regardless of declaration order and isolates inherited metadata', () => {
    @Workflow()
    class Base {
      @Compensate('prepare') async rollback() {}
      @Stage({ name: 'prepare' }) async prepare() {}
    }
    @Workflow()
    class Child extends Base {
      @Stage({ name: 'deploy', dependsOn: 'prepare' }) async deploy() {}
    }
    const base = Reflect.getMetadata(WORKFLOW_METADATA_KEY, Base);
    const child = Reflect.getMetadata(WORKFLOW_METADATA_KEY, Child);
    expect(base.stages.get('prepare').compensate).toBe(Base.prototype.rollback);
    expect(base.stages.has('deploy')).toBe(false);
    expect(child.stages.has('deploy')).toBe(true);
  });
});
