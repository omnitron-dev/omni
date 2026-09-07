/**
 * An app that fails to START is retried, like one that fails after starting.
 *
 * Omnitron carries a complete restart policy — bounded attempts, exponential
 * backoff, and a ten-minute cool-down that resets the budget and tries once
 * more, described in its own comment as "bounded self-healing". Reaching it
 * required an app to crash AFTER it had run: `markCrashed()` increments the
 * counter and `handleClassicCrash` schedules the retry.
 *
 * An app that never reached `online` took the other branch — `markErrored()`,
 * which sets a status and nothing else. `'errored'` appears nowhere in this
 * codebase except formatters, the status command and a metrics label: no code
 * reads it, so nothing ever tried again. One attempt, then errored until a
 * human noticed.
 *
 * The asymmetry is backwards. A failure to start is MORE likely to be
 * transient than a crash after a successful boot: a dependency still coming
 * up, a disk still cold, a machine briefly loaded. Observed here — six
 * bootstrap apps timed out at `config:loading` and `module:importing` under a
 * load average of 149, and stayed down after the load passed, because nothing
 * asked again.
 *
 * The policy is reused rather than reimplemented. A second copy would be a
 * second registry of the same decision, which is how two mechanisms that both
 * look canonical come to disagree.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { OrchestratorService } from '../../src/orchestrator/orchestrator.service.js';
import type { IEcosystemConfig, IEcosystemAppEntry } from '../../src/config/types.js';

const logger: any = {
  info() {}, warn() {}, error() {}, debug() {}, trace() {}, fatal() {},
  child() { return logger; },
};

function config(maxRestarts = 3): IEcosystemConfig {
  return {
    apps: [],
    supervision: { strategy: 'one_for_one', maxRestarts, window: 60_000, backoff: { type: 'exponential', initial: 100, max: 1_000, factor: 2 } },
    monitoring: { healthCheck: { interval: 15_000, timeout: 5_000 }, metrics: { interval: 5_000, retention: 3_600_000 } },
    logging: { level: 'info', maxSize: '50mb', maxFiles: 10, compress: true, databaseRetentionDays: 14 },
  } as unknown as IEcosystemConfig;
}

function orchestrator() {
  const pm: any = { getWorkerHandle: () => undefined, getProcess: () => undefined };
  const stateStore: any = { save() {}, load: () => null };
  return new OrchestratorService(logger, pm, stateStore, process.cwd());
}

const entry: IEcosystemAppEntry = { name: 'demo', script: './demo.js' } as IEcosystemAppEntry;

describe('a start that fails is retried under the restart policy', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('schedules another attempt instead of leaving the app errored', async () => {
    const orch = orchestrator();
    const cfg = config();
    let attempts = 0;
    // Fail the launch itself — the seam production fails at when a worker
    // does not report ready inside its startup budget.
    (orch as any).launchClassicMode = async () => {
      attempts++;
      throw new Error('Worker startup timed out after 30000ms');
    };

    await expect(orch.startApp(entry, cfg)).rejects.toThrow(/timed out/);
    expect(attempts, 'the first attempt happened').toBe(1);

    const handle = (orch as any).handles.get('demo');
    expect(handle.status, 'it never ran, so `errored` is the right report').toBe('errored');

    // The claim: a second attempt is pending, not abandoned.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(attempts, 'a retry must have been scheduled and fired').toBeGreaterThan(1);
  });

  it('gives up after the configured budget rather than retrying forever', async () => {
    const orch = orchestrator();
    const cfg = config(3);
    let attempts = 0;
    (orch as any).launchClassicMode = async () => {
      attempts++;
      throw new Error('still failing');
    };

    await expect(orch.startApp(entry, cfg)).rejects.toThrow();
    // Well past any backoff the policy can produce, but short of the
    // ten-minute cool-down: the budget must stop the loop on its own.
    await vi.advanceTimersByTimeAsync(60_000);

    expect(attempts, 'attempts are bounded by maxRestarts').toBeLessThanOrEqual(5);
    expect(attempts, 'and it did keep trying up to the budget').toBeGreaterThan(1);
  });

  it('does not retry an app the operator stopped', async () => {
    const orch = orchestrator();
    const cfg = config();
    let attempts = 0;
    (orch as any).launchClassicMode = async () => {
      attempts++;
      throw new Error('fails');
    };

    await expect(orch.startApp(entry, cfg)).rejects.toThrow();
    const before = attempts;
    (orch as any).handles.get('demo').status = 'stopped';

    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempts, 'a stopped app must stay stopped').toBe(before);
  });
});
