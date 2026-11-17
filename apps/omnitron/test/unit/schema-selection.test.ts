import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import { validateSchemaTransitionForSelection } from '../../src/daemon/schema-transition.js';
import type { BackendArtifact } from '../../src/daemon/backend-candidate.js';
import { writePrivateRecord } from '../../src/daemon/execution-journal.js';
import { managedRuntimeFile } from '../../src/daemon/managed-runtime.js';
import { schemaPlanFile, type SchemaSnapshot, type SchemaTransitionPlan } from '../../src/database/schema-transition-plan.js';
import { schemaReceiptFile, schemaReceiptIndex } from '../../src/database/schema-compatibility.js';

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'schema-select-')); roots.push(root);
  const home = path.join(root, 'h'), directory = path.join(root, 'e');
  await fs.mkdir(home, { mode: 0o700 }); await fs.mkdir(directory, { mode: 0o700 });
  const source = { runtimeHash: 'a'.repeat(64), directory: path.join(root, 'old/dist'), schemaExpansionProtocol: 1, execPath: process.execPath } as BackendArtifact;
  const original = { ...source, runtimeHash: 'b'.repeat(64), directory: path.join(root, 'applied/dist') };
  const candidate = { ...source, runtimeHash: 'c'.repeat(64), directory: path.join(root, 'next/dist') };
  const base = { name: '001_initial', checksum: null, executedAt: '2026-01-01T00:00:00.000Z' };
  const addition = { name: '002_expansion', checksum: 'd'.repeat(64), executedAt: '2026-01-02T00:00:00.000Z' };
  const body = '// original schema\n', expansion = '// nullable field\n';
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  const after: SchemaSnapshot = { database: 'e'.repeat(64), registry: [base, addition], expansions: [{ ...addition, summary: 'Nullable field' }],
    inspection: { executed: [base, addition], pending: [], drift: [], missingFiles: [], unknownChecksums: [base.name] } };
  const before = structuredClone(after); before.registry = [base]; before.expansions = []; before.inspection.missingFiles = [addition.name];
  const observation = path.join(root, 'observed.json'), calls = path.join(root, 'calls.jsonl');
  await fs.writeFile(observation, JSON.stringify({ before, after }));
  for (const artifact of [source, original, candidate]) {
    await fs.mkdir(path.join(artifact.directory, 'database/migrations'), { recursive: true });
    await fs.mkdir(path.join(artifact.directory, 'database/slave-migrations'), { recursive: true });
    await fs.writeFile(path.join(artifact.directory, 'package.json'), '{"type":"module"}');
    await fs.writeFile(path.join(artifact.directory, 'database/migrations/001_initial.js'), body);
    await fs.writeFile(path.join(artifact.directory, 'database/migrations/index.js'), artifact === source ? '// old registry\n' : '// expanded registry\n');
    await fs.writeFile(path.join(artifact.directory, 'database/slave-migrations/index.js'), 'export const SLAVE_MIGRATIONS = [];\n');
    if (artifact !== source) await fs.writeFile(path.join(artifact.directory, 'database/migrations/002_expansion.js'), expansion);
    await fs.writeFile(path.join(artifact.directory, 'database/schema-worker.js'), `
      import fs from 'node:fs';
      if (process.argv[2] !== 'inspect') throw Error('DDL is forbidden');
      if (process.env.OMNITRON_HOME !== ${JSON.stringify(home)} || process.env.SCHEMA_TEST !== 'private-environment') throw Error('Wrong environment');
      fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(process.argv.slice(2))+'\\n');
      const snapshot = JSON.parse(fs.readFileSync(${JSON.stringify(observation)}, 'utf8'));
      console.log(JSON.stringify(process.argv[3] === ${JSON.stringify(source.directory)} ? snapshot.before : snapshot.after));
    `);
  }
  const plan: SchemaTransitionPlan = { protocol: 1, phase: 'applied', baseline: [base],
    receipt: { protocol: 1, id: randomUUID(), kind: 'master-expand', phase: 'applied', instanceHome: home,
      fromRuntime: source.runtimeHash, toRuntime: original.runtimeHash, database: after.database,
      baseFiles: { [base.name]: digest(body) }, additions: [{ name: addition.name, checksum: addition.checksum, fileHash: digest(expansion) }],
      approvedAt: '2026-01-02T00:00:00Z', appliedAt: '2026-01-02T00:00:01Z' },
    backend: { pid: 123, control: path.join(directory, 'c.sock'), socket: path.join(home, 'd.sock') },
    owner: { id: 'owner', pid: 124, inventory: 'f'.repeat(64) }, descriptions: ['Nullable field'] };
  const file = schemaPlanFile(home, plan.receipt.id);
  await writePrivateRecord(file, plan);
  await writePrivateRecord(schemaReceiptFile(home, plan.receipt.id), plan.receipt);
  await writePrivateRecord(schemaReceiptIndex(home), { protocol: 1, receipts: [plan.receipt.id] });
  await writePrivateRecord(managedRuntimeFile(home), { protocol: 1, instanceHome: home, directory, scope: 'user', cwd: home,
    environment: { OMNITRON_HOME: home, SCHEMA_TEST: 'private-environment' },
    owner: { artifact: source.runtimeHash, label: 'dev.omnitron.test.owner', unit: 'omnitron-test-owner.service' },
    backend: { artifact: source.runtimeHash, label: 'dev.omnitron.test.backend', unit: 'omnitron-test-backend.service' } });
  const installation = { home, artifact: async (hash: string) => {
    const value = [source, original, candidate].find(item => item.runtimeHash === hash);
    if (!value) throw Error('Not installed'); return value;
  } };
  return { root, home, source, original, candidate, installation, file, plan, before, after, observation, calls };
}

it.each(['original', 'candidate', 'rollback'] as const)('admits %s from applied evidence without DDL, approval or history rewrites', async direction => {
  const f = await fixture();
  const files = [f.file, schemaReceiptFile(f.home, f.plan.receipt.id), schemaReceiptIndex(f.home), f.observation];
  const retained = await Promise.all(files.map(file => fs.readFile(file, 'utf8')));
  const current = direction === 'rollback' ? f.candidate : f.source;
  const candidate = direction === 'rollback' ? f.source : f[direction];
  await expect(validateSchemaTransitionForSelection(f.file, current, candidate, f.installation)).resolves.toEqual({
    id: f.plan.receipt.id, database: f.after.database, legacyIntegrityUnverified: ['001_initial'],
  });
  expect(await Promise.all(files.map(file => fs.readFile(file, 'utf8')))).toEqual(retained);
  expect((await fs.readFile(f.calls, 'utf8')).trim().split('\n').map(line => JSON.parse(line)[0])).toEqual(['inspect', 'inspect']);
});

it.each(['unapplied', 'foreign-instance', 'receipt', 'index', 'missing-index', 'managed-environment', 'original-body', 'candidate-body', 'registry', 'node-schema'])
('refuses %s before querying the database', async change => {
  const f = await fixture();
  if (change === 'unapplied') { f.plan.phase = 'approved'; f.plan.receipt.phase = 'approved'; await writePrivateRecord(f.file, f.plan); }
  if (change === 'foreign-instance') f.installation.home = path.join(f.root, 'other');
  if (change === 'receipt') await writePrivateRecord(schemaReceiptFile(f.home, f.plan.receipt.id), { ...f.plan.receipt, database: '0'.repeat(64) });
  if (change === 'index') await writePrivateRecord(schemaReceiptIndex(f.home), { protocol: 2, receipts: [f.plan.receipt.id] });
  if (change === 'missing-index') await fs.rm(schemaReceiptIndex(f.home));
  if (change === 'managed-environment') await fs.rm(managedRuntimeFile(f.home));
  if (change === 'original-body') await fs.appendFile(path.join(f.original.directory, 'database/migrations/002_expansion.js'), '// changed');
  if (change === 'candidate-body') await fs.appendFile(path.join(f.candidate.directory, 'database/migrations/001_initial.js'), '// changed');
  if (change === 'registry') await fs.appendFile(path.join(f.candidate.directory, 'database/migrations/index.js'), '// changed');
  if (change === 'node-schema') await fs.appendFile(path.join(f.candidate.directory, 'database/slave-migrations/index.js'), '// changed');
  await expect(validateSchemaTransitionForSelection(f.file, f.source, f.candidate, f.installation)).rejects.toThrow();
  await expect(fs.access(f.calls)).rejects.toMatchObject({ code: 'ENOENT' });
});

it.each(['foreign-database', 'pending', 'drift', 'history', 'checksum', 'extra', 'registry-order', 'policy'])
('rejects %s observed in the real selection inspection path', async change => {
  const f = await fixture();
  if (change === 'foreign-database') f.after.database = '0'.repeat(64);
  if (change === 'pending') f.after.inspection.pending.push('002_expansion');
  if (change === 'drift') f.after.inspection.drift.push({ name: '001_initial', recorded: 'a'.repeat(64), current: 'b'.repeat(64) });
  if (change === 'history') f.after.inspection.executed[0]!.executedAt = '2026-02-01T00:00:00Z';
  if (change === 'checksum') f.after.inspection.executed[1]!.checksum = null;
  if (change === 'extra') f.after.inspection.missingFiles.push('999_unknown');
  if (change === 'registry-order') f.after.registry.reverse();
  if (change === 'policy') f.after.expansions = [];
  await fs.writeFile(f.observation, JSON.stringify({ before: f.before, after: f.after }));
  await expect(validateSchemaTransitionForSelection(f.file, f.source, f.candidate, f.installation)).rejects.toThrow();
  expect(JSON.parse(await fs.readFile(f.file, 'utf8')).phase).toBe('applied');
});
