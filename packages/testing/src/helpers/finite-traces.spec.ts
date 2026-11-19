import { describe, expect, it } from 'vitest';
import { readTraceBounds, verifyFiniteTraces, type FiniteTraceModel } from './finite-traces.js';

type Action = 'reserve' | 'cancel' | 'confirm';
type State = 'new' | 'reserved' | 'cancelled' | 'confirmed';
const model: FiniteTraceModel<State, Action, State> = {
  initial: () => 'new',
  enabled: state => state === 'new' ? ['reserve'] : state === 'reserved' ? ['cancel', 'confirm'] : [],
  step: (_state, action) => ({ reserve: 'reserved', cancel: 'cancelled', confirm: 'confirmed' })[action] as State,
  project: state => state,
};

function fixture(onClose = () => {}, ignoreCancellation = false) {
  let observed: State = 'new';
  return {
    act(action: Action) {
      if (action === 'reserve') observed = 'reserved';
      if (action === 'cancel' && !ignoreCancellation) observed = 'cancelled';
      if (action === 'confirm') observed = 'confirmed';
    },
    observe: () => observed,
    close: onClose,
  };
}

describe('finite trace verification', () => {
  const bounds = { depth: 4, maxTraces: 2 };
  it('uses the explicit replay length and rejects invalid limits before execution', () => {
    expect(readTraceBounds('{"replay":["reserve"]}', bounds)).toEqual({ depth: 1, maxTraces: 2, replay: ['reserve'] });
    expect(() => readTraceBounds('{"replay":["reserve"],"depth":0}', bounds)).toThrow('within the declared depth');
    expect(() => readTraceBounds('{"maxTraces":0}', bounds)).toThrow('positive integer');
    expect(() => readTraceBounds('{"seed":5}', bounds)).toThrow('Expected trace options');
  });
  it('covers terminal prefixes and counts each executed observation', async () => {
    let closed = 0;
    expect(await verifyFiniteTraces(model, () => fixture(() => { closed++; }), bounds)).toMatchObject({
      verdict: 'matched', mode: 'bounded', completedTraces: 2, actions: 4, observations: 6,
    });
    expect(closed).toBe(2);
  });

  it('distinguishes a complete search at budget from an unexamined branch', async () => {
    expect(await verifyFiniteTraces(model, fixture, { ...bounds, maxTraces: 1 })).toMatchObject({
      verdict: 'inconclusive', completedTraces: 1, trace: ['reserve', 'confirm'],
    });
    expect(await verifyFiniteTraces(model, fixture, { depth: 0, maxTraces: 1 })).toMatchObject({
      verdict: 'matched', observations: 1, actions: 0, completedTraces: 1,
    });
  });

  it('detects an independently changed effect and replays the same divergent prefix', async () => {
    const open = () => fixture(() => {}, true);
    const report = await verifyFiniteTraces(model, open, bounds);
    expect(report).toMatchObject({
      verdict: 'mismatch', trace: ['reserve', 'cancel'], difference: { expected: 'cancelled', observed: 'reserved' },
    });
    expect(await verifyFiniteTraces(model, open, { ...bounds, replay: report.trace })).toMatchObject({
      mode: 'replay', verdict: 'mismatch', trace: report.trace, difference: report.difference,
    });
    expect(await verifyFiniteTraces(model, open, { ...bounds, replay: [] })).toMatchObject({
      mode: 'replay', verdict: 'matched', trace: [], actions: 0,
    });
  });

  it('validates the entire replay before opening and closes after an unavailable observation', async () => {
    let opened = 0, closed = 0;
    const open = () => {
      opened++;
      return { ...fixture(), observe() { throw Error('unavailable'); }, close() { closed++; } };
    };
    const bad = await verifyFiniteTraces(model, open, { ...bounds, replay: ['reserve', 'reserve'] });
    expect(bad).toMatchObject({ verdict: 'inconclusive', trace: ['reserve', 'reserve'], observations: 0 });
    expect(opened).toBe(0);
    expect(await verifyFiniteTraces(model, open, bounds)).toMatchObject({
      verdict: 'inconclusive', trace: [], reason: 'observe: unavailable',
    });
    expect(closed).toBe(1);
  });
});
