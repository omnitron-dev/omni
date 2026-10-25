import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { hostOperationBarrierCommand, type HostOperationAllowance } from '../../src/services/host-operation-barrier.js';
const roots: string[] = [];
const fixture = () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'host-operations-')));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const check = (root: string, allowance?: HostOperationAllowance) =>
  JSON.parse(
    execFileSync('sh', ['-c', hostOperationBarrierCommand(root, allowance)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  );
const journal = (root: string, name: string, id: string, outcome = 'running') => {
  const dir = join(root, 'platform-operations', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'pending.json'), JSON.stringify({ schema: 1, id, outcome }));
  return dir;
};
describe('durable host operation barrier', () => {
  it('permits a host without operations or with only finished receipts', () => {
    const root = fixture();
    expect(check(root)).toEqual({ clear: true, scoped: false });
    for (const [i, state] of ['complete', 'completed', 'rolled-back', 'recovered'].entries())
      journal(root, 'done' + i, 'id', state);
    expect(check(root).clear).toBe(true);
  });
  it('refuses application deployment after an interrupted platform transition', () => {
    const root = fixture();
    journal(root, 'platform', 'attempt');
    expect(() => check(root)).toThrow(/Unfinished host operations/);
    expect(check(root, { name: 'platform', id: 'attempt' })).toEqual({ clear: true, scoped: true });
    expect(() => check(root, { name: 'platform', id: 'different' })).toThrow();
  });
  it('scoped recovery cannot bypass another pending operation', () => {
    const root = fixture();
    journal(root, 'platform', 'attempt');
    journal(root, 'storage', 'other', 'recovery-required');
    expect(() => check(root, { name: 'platform', id: 'attempt' })).toThrow(/storage:other/);
  });
  it('requires an exact unfinished allowance even on an empty or finished host', () => {
    const root = fixture();
    expect(() => check(root, { name: 'platform', id: 'attempt' })).toThrow();
    journal(root, 'platform', 'attempt', 'complete');
    expect(() => check(root, { name: 'platform', id: 'attempt' })).toThrow();
  });
  it('fails closed for malformed journals and unknown outcomes', () => {
    const root = fixture();
    const dir = journal(root, 'platform', 'attempt', 'unknown');
    expect(() => check(root)).toThrow();
    writeFileSync(join(dir, 'pending.json'), '{partial');
    expect(() => check(root)).toThrow();
  });
  it('refuses aliased registry paths and dangling journal aliases', () => {
    const root = fixture();
    const elsewhere = fixture();
    symlinkSync(elsewhere, join(root, 'platform-operations'));
    expect(() => check(root)).toThrow(/not physical/);
    const second = fixture();
    const dir = journal(second, 'platform', 'attempt');
    rmSync(join(dir, 'pending.json'));
    symlinkSync(join(second, 'missing'), join(dir, 'pending.json'));
    expect(() => check(second)).toThrow(/not physical/);
  });
  it('refuses traversal in prefixes and scoped operation names', () => {
    expect(() => hostOperationBarrierCommand('/opt/../tmp')).toThrow();
    expect(() => hostOperationBarrierCommand('/opt/omnitron', { name: '../other', id: 'attempt' })).toThrow();
  });
});
