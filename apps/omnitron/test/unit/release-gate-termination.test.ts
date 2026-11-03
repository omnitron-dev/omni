import { expect, it } from 'vitest';
import { gateOutcomesFromGates } from '../../src/release/builder.js';

const success = JSON.stringify({ gates: [{ name: 'gates', outcome: 'passed' }] });
it.each(['timed-out', 'killed'] as const)('refuses %s even when a signal handler emits successful JSON and exits zero', termination => {
  expect(gateOutcomesFromGates(success, 0, termination)).toEqual([expect.objectContaining({ name: 'gates', status: termination })]);
  expect(gateOutcomesFromGates('incomplete output', 0, termination)).toEqual([expect.objectContaining({ status: termination })]);
});
it('retains a failing process verdict even after all checks report passed', () => {
  expect(gateOutcomesFromGates(success, 1)).toEqual([
    { name: 'gates', status: 'passed' }, { name: 'gates:runner', status: 'failed', detail: 'The release gate runner exited with code 1' },
  ]);
  expect(gateOutcomesFromGates(success, null).at(-1)).toMatchObject({ status: 'killed' });
  expect(gateOutcomesFromGates(success, 0)).toEqual([{ name: 'gates', status: 'passed' }]);
});
