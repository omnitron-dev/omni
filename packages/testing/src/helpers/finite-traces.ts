import { isDeepStrictEqual } from 'node:util';

type Awaitable<T> = Promise<T> | T;

/** Operations are stable public names. All model functions must be pure. */
export interface FiniteTraceModel<State, Action extends string, View> {
  initial(): State;
  enabled(state: State): readonly Action[];
  step(state: State, action: Action): State;
  project(state: State): View;
}

/** One fresh, isolated implementation for each trace. Return observable, public data. */
export interface TraceSubject<Action extends string, View> {
  act(action: Action): Awaitable<void>;
  observe(): Awaitable<View>;
  close(): Awaitable<void>;
}

export interface TraceBounds {
  depth: number;
  maxTraces: number;
  replay?: readonly string[];
}

function validateBounds({ depth, maxTraces, replay }: TraceBounds): void {
  if (!Number.isSafeInteger(depth) || depth < 0 || !Number.isSafeInteger(maxTraces) || maxTraces < 1) {
    throw new Error('depth must be a nonnegative integer and maxTraces a positive integer');
  }
  if (replay !== undefined &&
    (!Array.isArray(replay) || replay.length > depth || replay.some(action => typeof action !== 'string' || !action))) {
    throw new Error('Replay must be an array of nonempty action names within the declared depth');
  }
}

/** Read the same bounds for a package test and its Xec command. */
export function readTraceBounds(raw: string | undefined, defaults: Omit<TraceBounds, 'replay'>): TraceBounds {
  const input = raw === undefined ? {} : JSON.parse(raw);
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    Object.keys(input).some(key => !['depth', 'maxTraces', 'replay'].includes(key))) {
    throw new Error('Expected trace options with depth, maxTraces or replay');
  }
  const options = { ...defaults, ...(Array.isArray(input.replay) && { depth: input.replay.length }), ...input };
  validateBounds(options);
  return options;
}

export interface TraceReport<View> {
  mode: 'bounded' | 'replay';
  verdict: 'matched' | 'mismatch' | 'inconclusive';
  depth: number;
  maxTraces: number;
  completedTraces: number;
  actions: number;
  observations: number;
  elapsedMs: number;
  /** Exact reproducer, or the first unexamined trace at the budget boundary. */
  trace?: readonly string[];
  reason?: string;
  difference?: { expected: View; observed: View };
  cleanupError?: string;
}

function checkedActions<A extends string>(actions: readonly A[]): readonly A[] {
  if (new Set(actions).size !== actions.length || actions.some(action => typeof action !== 'string' || !action)) {
    throw new Error('Enabled actions must have unique, nonempty names');
  }
  return actions;
}

/** Iterate lazily. Each leaf also checks every prefix on its way there. */
function* leaves<State, A extends string, View>(
  model: FiniteTraceModel<State, A, View>, state: State, prefix: A[], depth: number,
): Generator<readonly A[]> {
  const actions = prefix.length === depth ? [] : checkedActions(model.enabled(state));
  if (!actions.length) {
    yield [...prefix];
    return;
  }
  for (const action of actions) {
    prefix.push(action);
    yield* leaves(model, model.step(state, action), prefix, depth);
    prefix.pop();
  }
}

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * Compare the initial observation and the observation after each declared action.
 * The subject receives only action names. A replay checks only its supplied path.
 * An exhausted budget or an unavailable observation cannot yield a match.
 */
export async function verifyFiniteTraces<State, A extends string, View>(
  model: FiniteTraceModel<State, A, View>, open: () => Awaitable<TraceSubject<A, View>>, options: TraceBounds,
): Promise<TraceReport<View>> {
  const { depth, maxTraces, replay } = options;
  validateBounds(options);
  const begin = performance.now();
  const report: TraceReport<View> = {
    mode: replay === undefined ? 'bounded' : 'replay', verdict: 'matched', depth, maxTraces,
    completedTraces: 0, actions: 0, observations: 0, elapsedMs: 0,
  };
  const paths = replay === undefined ? leaves(model, model.initial(), [], depth) : [replay];
  for (const path of paths) {
    if (report.completedTraces === maxTraces) {
      report.verdict = 'inconclusive';
      report.reason = 'trace budget reached';
      report.trace = path;
      break;
    }
    let state = model.initial();
    let subject: TraceSubject<A, View> | undefined;
    let phase = 'validate trace';
    const prefix: A[] = [];
    try {
      // Reject an invalid replay before opening a fixture or applying a partial path.
      let cursor = state;
      const actions = path.map(name => {
        const action = checkedActions(model.enabled(cursor)).find(candidate => candidate === name);
        if (action === undefined) throw new Error('Disabled or unknown model action ' + JSON.stringify(name));
        cursor = model.step(cursor, action);
        return action;
      });
      phase = 'open';
      subject = await open();
      const check = async () => {
        phase = 'observe';
        const expected = model.project(state);
        const observed = await subject!.observe();
        report.observations++;
        if (!isDeepStrictEqual(observed, expected)) {
          report.verdict = 'mismatch';
          report.trace = [...prefix];
          report.difference = { expected, observed };
        }
      };
      await check();
      for (const action of actions) {
        if (report.verdict !== 'matched') break;
        phase = 'act';
        prefix.push(action);
        state = model.step(state, action);
        report.actions++;
        await subject.act(action);
        await check();
      }
    } catch (error) {
      report.verdict = 'inconclusive';
      report.trace = subject ? [...prefix] : path;
      report.reason = phase + ': ' + message(error);
    } finally {
      try { await subject?.close(); }
      catch (error) {
        report.cleanupError = message(error);
        if (report.verdict === 'matched') {
          report.verdict = 'inconclusive';
          report.trace = path;
          report.reason = 'fixture cleanup failed';
        }
      }
    }
    if (report.verdict !== 'matched') break;
    report.completedTraces++;
  }
  if (replay !== undefined && report.verdict === 'matched') report.trace = replay;
  report.elapsedMs = Math.round(performance.now() - begin);
  return report;
}
