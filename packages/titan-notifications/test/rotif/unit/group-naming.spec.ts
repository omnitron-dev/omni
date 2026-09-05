/**
 * `groupNameFn` is the config-level counterpart of `consumerNameFn`. It was
 * declared on RotifConfig and read by nothing, so a caller who supplied one —
 * to keep consumer-group names consistent across services sharing a Redis, say
 * — silently got the default `grp:<pattern>` and a second, unexpected group
 * reading the same stream.
 */

import { describe, it, expect } from 'vitest';

import { getGroupName } from '../../../src/rotif/utils.js';

describe('consumer group naming', () => {
  it('defaults to grp:<pattern>', () => {
    expect(getGroupName('orders.created')).toBe('grp:orders.created');
  });

  it('takes an explicit per-subscription name', () => {
    expect(getGroupName('orders.created', 'billing-workers')).toBe('billing-workers');
  });
});

describe('groupNameFn wiring', () => {
  // The subscribe path composes the two: an explicit groupName wins, then the
  // config function, then the default. Asserted on the composition rather than
  // by standing up a manager, because the defect was in exactly that one
  // expression.
  const resolve = (pattern: string, explicit?: string, fn?: (p: string) => string) =>
    getGroupName(pattern, explicit ?? fn?.(pattern));

  it('uses the configured function when no explicit name is given', () => {
    expect(resolve('orders.created', undefined, (p) => `svc:${p}`)).toBe('svc:orders.created');
  });

  it('lets an explicit name win over the function', () => {
    expect(resolve('orders.created', 'explicit', (p) => `svc:${p}`)).toBe('explicit');
  });

  it('falls back to the default when neither is given', () => {
    expect(resolve('orders.created')).toBe('grp:orders.created');
  });
});
