import fs from 'node:fs/promises';
import path from 'node:path';
import { readPrivateRecord } from '../daemon/execution-journal.js';
import { validateSchemaExpansionReceipt, type SchemaExpansionReceipt } from './schema-compatibility.js';
import type { MigrationInspection, MigrationRecord } from '../migration/index.js';

export interface SchemaSnapshot {
  database: string;
  registry: Array<{ name: string; checksum: string | null }>;
  expansions: Array<{ name: string; checksum: string; summary: string }>;
  inspection: MigrationInspection;
}
export interface SchemaTransitionPlan {
  protocol: 1;
  phase: 'prepared' | 'approved' | 'applied';
  receipt: SchemaExpansionReceipt;
  baseline: MigrationRecord[];
  backend: { pid: number; control: string; socket: string };
  owner: { id: string; pid: number; inventory: string };
  descriptions: string[];
}
export const schemaPlanFile = (home: string, id: string) => path.join(home, 'runtime', `schema-transition-${id}.json`);
export const historyIdentity = (records: MigrationRecord[]) => JSON.stringify(records.map(row => ({
  name: row.name, checksum: row.checksum, executedAt: row.executedAt === null ? null : new Date(row.executedAt).toISOString(),
})));

export async function readSchemaPlan(file: string): Promise<SchemaTransitionPlan> {
  const stat = await fs.lstat(file);
  if (stat.size > 512 * 1024) throw new Error('Schema transition plan exceeds its size limit');
  const plan = await readPrivateRecord<SchemaTransitionPlan>(file);
  if (!plan || plan.protocol !== 1 || !['prepared', 'approved', 'applied'].includes(plan.phase)) throw new Error('Invalid schema transition plan');
  const receipt = validateSchemaExpansionReceipt(plan.receipt);
  if (path.resolve(file) !== schemaPlanFile(receipt.instanceHome, receipt.id) ||
      !Array.isArray(plan.baseline) || plan.baseline.length > 1000 ||
      !plan.baseline.every(row => row && typeof row.name === 'string' && Object.hasOwn(receipt.baseFiles, row.name) &&
        (row.checksum === null || /^[a-f0-9]{64}$/.test(row.checksum)) &&
        (row.executedAt === null || Number.isFinite(new Date(row.executedAt).getTime()))) ||
      new Set(plan.baseline.map(row => row.name)).size !== plan.baseline.length ||
      !Number.isSafeInteger(plan.backend?.pid) || plan.backend.pid < 1 ||
      !path.isAbsolute(plan.backend.control ?? '') || !path.isAbsolute(plan.backend.socket ?? '') ||
      typeof plan.owner?.id !== 'string' || !Number.isSafeInteger(plan.owner.pid) || plan.owner.pid < 1 ||
      !/^[a-f0-9]{64}$/.test(plan.owner.inventory) ||
      !Array.isArray(plan.descriptions) || !plan.descriptions.every(text => typeof text === 'string' && text.length <= 2000) ||
      (plan.phase === 'applied') !== (receipt.phase === 'applied')) throw new Error('Invalid schema transition binding');
  return plan;
}

/** Re-run under Kysera's existing lock, including on retry after a partial commit. */
export function assertSchemaHistory(plan: SchemaTransitionPlan, snapshot: SchemaSnapshot): void {
  const report = snapshot.inspection;
  if (snapshot.database !== plan.receipt.database) throw new Error('Schema plan belongs to another database');
  if (report.drift.length || report.missingFiles.length) throw new Error('Schema history contains drift or unknown migrations');
  const base = report.executed.filter(row => Object.hasOwn(plan.receipt.baseFiles, row.name));
  if (historyIdentity(base) !== historyIdentity(plan.baseline)) throw new Error('Migration history changed since preparation');
  const future = report.executed.filter(row => !Object.hasOwn(plan.receipt.baseFiles, row.name));
  if (future.length > plan.receipt.additions.length || future.some((row, index) => {
    const expected = plan.receipt.additions[index];
    return row.name !== expected?.name || row.checksum !== expected.checksum;
  })) throw new Error('Unreviewed migration history cannot be resumed');
  const pending = plan.receipt.additions.slice(future.length).map(row => row.name);
  if (JSON.stringify(report.pending) !== JSON.stringify(pending)) throw new Error('Pending migrations changed since preparation');
}

export function planSchemaAdditions(before: SchemaSnapshot, after: SchemaSnapshot, oldFiles: Record<string, string>, nextFiles: Record<string, string>) {
  if (before.database !== after.database || before.inspection.pending.length || before.inspection.drift.length ||
      before.inspection.missingFiles.length || after.inspection.drift.length || after.inspection.missingFiles.length) {
    throw new Error('Schema expansion requires a current source schema without drift or unknown migrations');
  }
  if (JSON.stringify(before.registry.map(m => m.name)) !== JSON.stringify(Object.keys(oldFiles).sort()) ||
      JSON.stringify(after.registry.map(m => m.name)) !== JSON.stringify(Object.keys(nextFiles).sort()) ||
      before.registry.some((m, i) => m.name !== after.registry[i]?.name || m.checksum !== after.registry[i]?.checksum || oldFiles[m.name] !== nextFiles[m.name])) {
    throw new Error('Existing migration bodies or registry order changed');
  }
  const additions = after.registry.slice(before.registry.length);
  if (!additions.length || JSON.stringify(after.inspection.pending) !== JSON.stringify(additions.map(m => m.name)) ||
      historyIdentity(before.inspection.executed) !== historyIdentity(after.inspection.executed)) {
    throw new Error('Only the exact pending append-only expansion can be prepared');
  }
  return additions.map(m => {
    const policy = after.expansions.find(p => p.name === m.name && p.checksum === m.checksum);
    if (!policy || !m.checksum) throw new Error(`Migration ${m.name} has no reviewed backward-compatible expansion policy`);
    return { name: m.name, checksum: m.checksum, fileHash: nextFiles[m.name]!, summary: policy.summary };
  });
}
