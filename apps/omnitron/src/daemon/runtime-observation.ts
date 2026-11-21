import { setTimeout as delay } from 'node:timers/promises';
import { CommandResultError } from '../shared/command-result.js';

/** A reviewed native start is asynchronous. Explicit reachability evidence is
 * pending until the shared deadline; unknown transport failures remain unknown. */
export async function observeStartingController<T>(read: () => Promise<T>): Promise<T> {
  try { return await read(); }
  catch (error) {
    if (error instanceof CommandResultError && error.code === 'DAEMON_UNAVAILABLE') {
      const reported = error.details['reported'] as { absence?: { kind?: unknown; pid?: unknown } } | undefined;
      const absence = reported?.absence;
      if (absence && ['stopped', 'stale', 'silent'].includes(String(absence.kind))) {
        throw new RuntimeObservationPending('controller', 'Waiting for the reviewed controller to answer',
          typeof absence.pid === 'number' && Number.isSafeInteger(absence.pid) && absence.pid > 0 ? absence.pid : undefined);
      }
    }
    throw error;
  }
}

/** Only an explicitly incomplete observation is retryable. Ownership conflicts,
 * malformed evidence and unclassified failures are never converted to waiting. */
export class RuntimeObservationPending extends Error {
  readonly code = 'RUNTIME_OBSERVATION_PENDING';
  readonly details: { stage: string; pid?: number };
  constructor(stage: string, message: string, pid?: number) {
    super(message);
    this.details = { stage, ...(pid !== undefined && { pid }) };
  }
}

/** Read failures cannot prove that the serving candidate failed or authorize
 * another native effect. The original cause remains available for inspection. */
export class RuntimeObservationUnconfirmed extends Error {
  readonly code: string = 'RUNTIME_OBSERVATION_UNCONFIRMED';
  constructor(message: string, cause?: unknown) { super(message, { cause }); }
}

export class RuntimeObservationTimeout extends RuntimeObservationUnconfirmed {
  override readonly code = 'RUNTIME_OBSERVATION_TIMEOUT';
  readonly details?: { timeoutMs: number; lastObservation?: { stage: string; pid?: number; reason: string } };

  constructor(label: string, timeoutMs?: number, pending?: RuntimeObservationPending) {
    const limit = timeoutMs === undefined ? label : `${label} after ${timeoutMs} ms`;
    const last = pending && { ...pending.details, reason: pending.message };
    const pid = last?.pid === undefined ? '' : ` (PID ${last.pid})`;
    super(last ? `${limit}. Last pending observation in ${last.stage}${pid} — ${last.reason}` : limit, pending);
    if (timeoutMs !== undefined) this.details = { timeoutMs, ...(last && { lastObservation: last }) };
  }
}

/** A complete observation contradicts the reviewed intent. */
export class RuntimeObservationConflict extends Error {
  readonly code = 'RUNTIME_OBSERVATION_CONFLICT';
}

export interface RuntimeObservation {
  readonly signal: AbortSignal;
  remaining(maximum?: number): number;
}

/** One deadline covers the entire read-only observation, including its leaf
 * calls. An expired observation cannot publish success or authorize recovery. */
export async function withRuntimeObservation<T>(observe: (observation: RuntimeObservation) => Promise<T>,
  budget: number, label: string, lastPending?: () => RuntimeObservationPending | undefined): Promise<T> {
  if (!Number.isFinite(budget) || budget <= 0) throw Error('Invalid runtime observation budget');
  const deadline = performance.now() + budget;
  const controller = new AbortController();
  const timeout = () => new RuntimeObservationTimeout(label, budget, lastPending?.());
  const observation: RuntimeObservation = {
    signal: controller.signal,
    remaining(maximum = budget) {
      controller.signal.throwIfAborted();
      const left = Math.ceil(deadline - performance.now());
      if (left <= 0) throw timeout();
      return Math.max(1, Math.min(left, maximum));
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = timeout();
      controller.abort(error);
      reject(error);
    }, budget);
  });
  try {
    const result = await Promise.race([observe(observation), expired]);
    observation.remaining();
    return result;
  } catch (error) {
    if (controller.signal.aborted) throw controller.signal.reason;
    throw error;
  } finally { clearTimeout(timer); }
}

export function observeRuntimeUntil<T>(observe: (observation: RuntimeObservation) => Promise<T>,
  budget: number, label: string, interval = 2000, progress: (message: string) => void = () => {}): Promise<T> {
  let pending: RuntimeObservationPending | undefined;
  return withRuntimeObservation(async observation => {
    for (;;) {
      observation.remaining();
      try { return await observe(observation); }
      catch (error) {
        observation.remaining();
        if (!(error instanceof RuntimeObservationPending)) throw error;
        if (pending?.message !== error.message) progress(error.message);
        pending = error;
      }
      await delay(Math.min(interval, observation.remaining()), undefined, { signal: observation.signal });
    }
  }, budget, label, () => pending);
}
