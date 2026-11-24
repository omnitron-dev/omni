import { describe, expect, it } from 'vitest';

// Specification model for OWNER-ACCESS-RECOVERY.md. One UUID, subject and digest.
// Each event represents one durable transaction. A commit sends no implicit ACK.
type Controller = 'pending' | 'approved' | 'claimed' | 'cancelled' | 'expired' | 'applied' | 'fenced';
type Receipt = 'absent' | 'applied' | 'fenced';
type State = {
  controller: Controller;
  receipt: Receipt;
  codeSpent: boolean;
  deadlinePassed: boolean;
  fenceRequested: boolean;
  credentialRevision: number;
};

const events = ['approve', 'claim', 'cancel', 'deadline', 'deliver', 'fence', 'readReceipt'] as const;
type Event = (typeof events)[number];
const initial: State = {
  controller: 'pending',
  receipt: 'absent',
  codeSpent: false,
  deadlinePassed: false,
  fenceRequested: false,
  credentialRevision: 0,
};

function step(state: State, event: Event): State {
  const open = state.controller === 'pending' || state.controller === 'approved';
  switch (event) {
    case 'approve':
      if (state.controller === 'pending' && !state.deadlinePassed && !state.codeSpent) {
        return { ...state, controller: 'approved', codeSpent: true };
      }
      break;
    case 'claim':
      if (state.controller === 'approved' && !state.deadlinePassed) return { ...state, controller: 'claimed' };
      break;
    case 'cancel':
      if (open) return { ...state, controller: 'cancelled' };
      if (state.controller === 'claimed') return { ...state, fenceRequested: true };
      break;
    case 'deadline':
      if (open) return { ...state, deadlinePassed: true, controller: 'expired' };
      return { ...state, deadlinePassed: true, fenceRequested: state.fenceRequested || state.controller === 'claimed' };
    case 'deliver':
      if (state.controller === 'claimed' && !state.deadlinePassed && state.receipt === 'absent') {
        return { ...state, receipt: 'applied', credentialRevision: state.credentialRevision + 1 };
      }
      break;
    case 'fence':
      if (state.fenceRequested && state.receipt === 'absent') return { ...state, receipt: 'fenced' };
      break;
    case 'readReceipt':
      if (state.controller === 'claimed' && state.receipt !== 'absent') return { ...state, controller: state.receipt };
      break;
    default:
      throw new Error(`Unhandled recovery event: ${event satisfies never}`);
  }
  return state;
}

function after(...sequence: Event[]): State {
  return sequence.reduce(step, initial);
}

describe('single-owner recovery v1 specification model', () => {
  it('keeps controller outcomes consistent with the application under every reachable event ordering', () => {
    const work = [initial];
    const visited = new Set<string>();
    const terminals = new Set<Controller>();
    while (work.length) {
      const state = work.pop()!;
      const key = JSON.stringify(state);
      if (visited.has(key)) continue;
      visited.add(key);
      expect(state.credentialRevision).toBe(state.receipt === 'applied' ? 1 : 0);
      if (state.receipt !== 'absent') expect(state.codeSpent).toBe(true);
      if (state.controller === 'applied' || state.controller === 'fenced') {
        expect(state.controller).toBe(state.receipt);
        terminals.add(state.controller);
      }
      if (state.controller === 'cancelled' || state.controller === 'expired') {
        expect(state.receipt).toBe('absent');
        terminals.add(state.controller);
      }
      if (state.controller === 'claimed') {
        const resolved = step(step(step(state, 'cancel'), 'fence'), 'readReceipt');
        expect(resolved.controller).toBe(state.credentialRevision === 1 ? 'applied' : 'fenced');
        expect(resolved.credentialRevision).toBe(state.credentialRevision);
      }
      for (const event of events) {
        const next = step(state, event);
        if (state.codeSpent) expect(next.codeSpent).toBe(true);
        if (state.receipt !== 'absent') expect(next.receipt).toBe(state.receipt);
        if (state.deadlinePassed) expect(next.credentialRevision).toBe(state.credentialRevision);
        // Bound the exploration even if a future change allows repeated effects.
        expect(next.credentialRevision).toBeLessThanOrEqual(1);
        work.push(next);
      }
    }
    expect(terminals).toEqual(new Set(['applied', 'cancelled', 'expired', 'fenced']));
  });

  it('can observe no receipt and later reconcile a committed change despite cancellation and a lost reply', () => {
    const beforeDelivery = after('approve', 'claim', 'readReceipt', 'cancel');
    expect(beforeDelivery).toMatchObject({ controller: 'claimed', receipt: 'absent', fenceRequested: true });
    const committed = step(beforeDelivery, 'deliver');
    expect(committed).toMatchObject({ controller: 'claimed', receipt: 'applied', credentialRevision: 1 });
    expect(step(step(committed, 'deadline'), 'readReceipt').controller).toBe('applied');
  });

  it('returns a durable fence if cancellation wins at the application and delivery arrives later', () => {
    const stopped = after('approve', 'claim', 'cancel', 'fence', 'deliver', 'readReceipt', 'deliver');
    expect(stopped).toMatchObject({ controller: 'fenced', receipt: 'fenced', credentialRevision: 0, codeSpent: true });
  });
});
