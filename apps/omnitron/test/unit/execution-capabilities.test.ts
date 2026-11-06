import { expect, it } from 'vitest';
import { assertExecutionCapabilities, OWNER_CAPABILITIES, readExecutionCapabilities } from '../../src/daemon/execution-capabilities.js';

it('requires explicit semantic contracts without inferring them from a wire version', () => {
  expect(() => assertExecutionCapabilities(undefined, { stackControl: 1 })).toThrow('stackControl@1');
  expect(() => assertExecutionCapabilities({ stackControl: 2 }, { stackControl: 1 })).toThrow('stackControl@1');
  expect(() => assertExecutionCapabilities({ stackControl: 1, newerFeature: 1 }, { stackControl: 1 })).not.toThrow();
  expect(() => assertExecutionCapabilities(undefined, {})).not.toThrow();
  expect(() => assertExecutionCapabilities({ stackControl: 1 }, { applicationRuntimeResolution: 1 }))
    .toThrow('applicationRuntimeResolution@1');
  expect(() => assertExecutionCapabilities(OWNER_CAPABILITIES, { applicationRuntimeResolution: 1 })).not.toThrow();
});

it.each([null, [], 'stackControl', { stackControl: 0 }, { stackControl: -1 }, { stackControl: 1.5 }, { stackControl: '1' }, { 'bad/key': 1 }])(
  'rejects malformed capabilities: %j', value => {
    expect(() => readExecutionCapabilities(value)).toThrow('Invalid execution capability');
  },
);
