import { describe, expect, it } from 'vitest';
import { assertOwnerReconciliationEvidence, type OwnerReconciliationPlan } from '../../src/daemon/owner-reconciliation.js';

const plan = { bootId: 'boot-a', processes: [{ pid: 10, lifetime: null }, { pid: 20, lifetime: 'boot-a:200' }] } as OwnerReconciliationPlan;
const stopped = () => ({ bootId: 'boot-a', units: [{ mainPid: 0, state: 'failed' }, { mainPid: 0, state: 'inactive' }],
  groups: [[], []] as number[][], processes: [{ pid: 10, lifetime: null }, { pid: 20, lifetime: null }] as Array<{ pid: number; lifetime: string | null; unknown?: boolean }>, sockets: [] as string[] });

describe('explicit execution-owner crash reconciliation', () => {
  it('accepts only empty stopped ownership domains with all recorded identities gone', () => {
    expect(() => assertOwnerReconciliationEvidence(plan, stopped())).not.toThrow();
  });
  it('refuses a surviving orphan even when both service main PIDs are zero', () => {
    const evidence = stopped(); evidence.groups[0] = [20];
    expect(() => assertOwnerReconciliationEvidence(plan, evidence)).toThrow('cgroup');
  });
  it.each([0, 1])('refuses an active owner/backend service (%s)', index => {
    const evidence = stopped(); evidence.units[index] = { mainPid: 30, state: 'active' };
    expect(() => assertOwnerReconciliationEvidence(plan, evidence)).toThrow('services must be stopped');
  });
  it('refuses descendants even when service main PIDs have exited', () => {
    const evidence = stopped(); evidence.groups[1] = [30];
    expect(() => assertOwnerReconciliationEvidence(plan, evidence)).toThrow('cgroup');
  });
  it('refuses a process moved outside the expected cgroup', () => {
    const evidence = stopped(); evidence.processes[1]!.lifetime = 'boot-a:200';
    expect(() => assertOwnerReconciliationEvidence(plan, evidence)).toThrow('20');
  });
  it('distinguishes PID reuse from the old process lifetime', () => {
    const evidence = stopped(); evidence.processes[1]!.lifetime = 'boot-a:999';
    expect(() => assertOwnerReconciliationEvidence(plan, evidence)).not.toThrow();
  });
  it('does not infer death when lifetime inspection fails or an identity was never captured', () => {
    const unknown = stopped(); unknown.processes[1]!.unknown = true;
    expect(() => assertOwnerReconciliationEvidence(plan, unknown)).toThrow('20');
    const missing = stopped(); missing.processes.pop();
    expect(() => assertOwnerReconciliationEvidence(plan, missing)).toThrow('20');
    const ambiguous = stopped(); ambiguous.processes[0]!.lifetime = 'boot-a:123';
    expect(() => assertOwnerReconciliationEvidence(plan, ambiguous)).toThrow('10');
  });
  it('refuses boot changes and a still-registered owner socket', () => {
    expect(() => assertOwnerReconciliationEvidence(plan, { ...stopped(), bootId: 'boot-b' })).toThrow('Host boot');
    expect(() => assertOwnerReconciliationEvidence(plan, { ...stopped(), sockets: ['owner.sock'] })).toThrow('socket');
  });
  it('allows the new service-owned owner only after all predecessor identities are gone', () => {
    const evidence = stopped(); evidence.units[0] = { mainPid: 30, state: 'activating' }; evidence.groups[0] = [30];
    expect(() => assertOwnerReconciliationEvidence(plan, evidence, 30)).not.toThrow();
    evidence.groups[0].push(20);
    expect(() => assertOwnerReconciliationEvidence(plan, evidence, 30)).toThrow('cgroup');
  });
});
