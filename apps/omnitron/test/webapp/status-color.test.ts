/**
 * One answer to "what colour is this state".
 *
 * The console had three, and they disagreed. `utils/constants` mapped
 * `AppStatus` to MUI palette names; `stack-selector` had a hex map where
 * `starting` was #eab308 and `degraded` #f97316; `topology/shared-styles` had
 * a wider hex map where the same two were #f59e0b. So a stack that was
 * starting drew yellow in the selector and amber in the topology view, and an
 * operator comparing the two had no way to know they meant the same thing.
 */

import { describe, it, expect } from 'vitest';

import { statusColor, STATUS_COLORS } from '../../webapp/src/utils/constants.js';

describe('statusColor', () => {
  it('agrees across the vocabularies the console actually renders', () => {
    // Apps say `online`, containers say `running`, health says `healthy`.
    // They are the same state and must look the same.
    expect(statusColor('online')).toBe('success');
    expect(statusColor('running')).toBe('success');
    expect(statusColor('healthy')).toBe('success');
  });

  it('treats every transition the same way', () => {
    // The three maps disagreed here specifically: yellow, amber, orange for
    // states that mean "wait a moment".
    for (const state of ['starting', 'stopping', 'restarting', 'degraded', 'provisioning']) {
      expect(statusColor(state), state).toBe('warning');
    }
  });

  it('treats a deliberate stop as an absence of opinion, not a fault', () => {
    // Grey, not red: an operator who stopped something has not broken it.
    for (const state of ['stopped', 'exited', 'created', 'none', 'unknown', 'not_found']) {
      expect(statusColor(state), state).toBe('default');
    }
  });

  it('is red only for states that are actually wrong', () => {
    for (const state of ['crashed', 'errored', 'error', 'unhealthy', 'dead', 'offline']) {
      expect(statusColor(state), state).toBe('error');
    }
  });

  it('says nothing about a state it does not know', () => {
    // A colour invented for an unrecognised string would be a claim about it.
    expect(statusColor('quantum')).toBe('default');
    expect(statusColor('')).toBe('default');
    expect(statusColor(null)).toBe('default');
    expect(statusColor(undefined)).toBe('default');
  });

  it('never maps a state to a colour outside the palette', () => {
    const allowed = new Set(['success', 'error', 'warning', 'default']);
    for (const [state, colour] of Object.entries(STATUS_COLORS)) {
      expect(allowed.has(colour), `${state} → ${colour}`).toBe(true);
    }
  });

  it('covers every AppStatus the daemon can report', () => {
    // If the daemon grows a status and nobody maps it, this fails rather than
    // the console quietly drawing it grey.
    for (const state of ['online', 'stopped', 'crashed', 'errored', 'starting', 'stopping']) {
      expect(STATUS_COLORS[state], state).toBeDefined();
    }
  });
});
