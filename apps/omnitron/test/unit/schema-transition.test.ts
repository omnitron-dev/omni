import { describe, expect, it } from 'vitest';
import { assertSchemaHistory, planSchemaAdditions, type SchemaSnapshot, type SchemaTransitionPlan } from '../../src/database/schema-transition-plan.js';

const base = { name: '001_initial', checksum: null, executedAt: '2026-01-01T00:00:00.000Z' };
const checksum = 'c'.repeat(64);
const next = { name: '002_expansion', checksum };
const oldFiles = { [base.name]: 'a'.repeat(64) };
const newFiles = { ...oldFiles, [next.name]: 'b'.repeat(64) };
const snapshot = (future = false): SchemaSnapshot => ({
  database: 'd'.repeat(64),
  registry: future ? [{ name: base.name, checksum: null }, next] : [{ name: base.name, checksum: null }],
  expansions: [{ ...next, summary: 'Reviewed additive definition' }],
  inspection: { executed: [base], pending: future ? [next.name] : [], drift: [], missingFiles: [], unknownChecksums: [base.name] },
});
const plan = (): SchemaTransitionPlan => ({
  protocol: 1, phase: 'approved', baseline: [base],
  receipt: { protocol: 1, id: '00000000-0000-4000-8000-000000000001', kind: 'master-expand', phase: 'approved',
    instanceHome: '/private/instance', fromRuntime: 'e'.repeat(64), toRuntime: 'f'.repeat(64), database: 'd'.repeat(64),
    baseFiles: oldFiles, additions: [{ ...next, fileHash: newFiles[next.name] }], approvedAt: '2026-01-01T00:00:00Z' },
  backend: { pid: 12, control: '/private/instance/control.sock', socket: '/private/instance/daemon.sock' },
  owner: { id: 'owner', pid: 11, inventory: 'a'.repeat(64) }, descriptions: ['Reviewed additive definition'],
});

describe('exact online schema transition', () => {
  it('prepares only an ordered, reviewed append with unchanged deployed definitions', () => {
    expect(planSchemaAdditions(snapshot(), snapshot(true), oldFiles, newFiles)).toEqual([{ ...next, fileHash: newFiles[next.name], summary: 'Reviewed additive definition' }]);
    expect(() => planSchemaAdditions(snapshot(), snapshot(true), oldFiles, { ...newFiles, [base.name]: '0'.repeat(64) })).toThrow('bodies');
    const reordered = snapshot(true); reordered.registry.reverse();
    expect(() => planSchemaAdditions(snapshot(), reordered, oldFiles, newFiles)).toThrow('registry order');
    const unchecked = snapshot(true); unchecked.expansions = [];
    expect(() => planSchemaAdditions(snapshot(), unchecked, oldFiles, newFiles)).toThrow('reviewed');
    const renamed = snapshot(true); renamed.registry[0]!.name = '000_rewritten';
    expect(() => planSchemaAdditions(snapshot(), renamed, oldFiles, newFiles)).toThrow('registry order');
  });

  it('refuses a different database, drift and unrelated pending history before approval', () => {
    const foreign = snapshot(true); foreign.database = '0'.repeat(64);
    expect(() => planSchemaAdditions(snapshot(), foreign, oldFiles, newFiles)).toThrow('current source schema');
    const drift = snapshot(true); drift.inspection.drift = [{ name: base.name, recorded: checksum, current: '0'.repeat(64) }];
    expect(() => planSchemaAdditions(snapshot(), drift, oldFiles, newFiles)).toThrow('drift');
    const unknown = snapshot(true); unknown.inspection.missingFiles = ['999_unknown'];
    expect(() => planSchemaAdditions(snapshot(), unknown, oldFiles, newFiles)).toThrow('unknown');
    const pending = snapshot(true); pending.inspection.pending.unshift(base.name);
    expect(() => planSchemaAdditions(snapshot(), pending, oldFiles, newFiles)).toThrow('exact pending');
  });

  it('resumes after commit without relabeling legacy integrity or replaying the migration', () => {
    const prepared = plan();
    expect(() => assertSchemaHistory(prepared, snapshot(true))).not.toThrow();
    const committed = snapshot(true);
    committed.inspection.executed.push({ ...next, executedAt: '2026-01-02T00:00:00Z' });
    committed.inspection.pending = [];
    expect(() => assertSchemaHistory(prepared, committed)).not.toThrow();
    const changed = structuredClone(committed);
    changed.inspection.executed[0]!.checksum = checksum;
    expect(() => assertSchemaHistory(prepared, changed)).toThrow('history changed');
    changed.inspection.executed[0] = base;
    changed.inspection.executed[1]!.checksum = null;
    expect(() => assertSchemaHistory(prepared, changed)).toThrow('Unreviewed');
  });

  it('fences concurrent schema changes under the shared migration lock', () => {
    const prepared = plan();
    const unexpected = snapshot(true);
    unexpected.inspection.executed.push({ name: '999_unreviewed', checksum, executedAt: new Date() });
    expect(() => assertSchemaHistory(prepared, unexpected)).toThrow('Unreviewed');
    const removed = snapshot(true); removed.inspection.executed = [];
    expect(() => assertSchemaHistory(prepared, removed)).toThrow('history changed');
    const foreign = snapshot(true); foreign.database = '0'.repeat(64);
    expect(() => assertSchemaHistory(prepared, foreign)).toThrow('another database');
  });
});
