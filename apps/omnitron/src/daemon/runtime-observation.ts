import { setTimeout as delay } from 'node:timers/promises';

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
  budget: number, label: string): Promise<T> {
  if (!Number.isFinite(budget) || budget <= 0) throw Error('Invalid runtime observation budget');
  const deadline = performance.now() + budget;
  const controller = new AbortController();
  const observation: RuntimeObservation = {
    signal: controller.signal,
    remaining(maximum = budget) {
      controller.signal.throwIfAborted();
      const left = Math.ceil(deadline - performance.now());
      if (left <= 0) throw new RuntimeObservationTimeout(label);
      return Math.max(1, Math.min(left, maximum));
    },
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new RuntimeObservationTimeout(label);
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
  return withRuntimeObservation(async observation => {
    let pending: RuntimeObservationPending | undefined;
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
  }, budget, label);
}
