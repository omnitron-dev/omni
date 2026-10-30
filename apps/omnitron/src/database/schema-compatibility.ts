import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { sql, type Kysely } from 'kysely';
import { OMNITRON_HOME } from '../config/defaults.js';
import { readPrivateRecord } from '../daemon/execution-journal.js';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';
import { resolveOmnitronPgConfig } from './connection.js';
import type { MigrationRecord } from '../migration/index.js';

export interface SchemaExpansionReceipt {
  protocol: 1;
  id: string;
  kind: 'master-expand';
  phase: 'approved' | 'applied';
  instanceHome: string;
  fromRuntime: string;
  toRuntime: string;
  baseFiles: Record<string, string>;
  database: string;
  additions: Array<{ name: string; fileHash: string; checksum: string }>;
  approvedAt: string;
  appliedAt?: string;
}

const SHA256 = /^[a-f0-9]{64}$/;
const MIGRATION = /^\d{3}_[a-z0-9_]+$/;
export const schemaReceiptFile = (home: string, id: string) => path.join(home, 'runtime', `schema-expansion-${id}.json`);
export const schemaReceiptIndex = (home: string) => path.join(home, 'runtime', 'schema-expansions.json');

/** Hash only immutable migration bodies; the ordered registry is checked by the planner. */
export async function masterMigrationFiles(dist: string): Promise<Record<string, string>> {
  const root = path.join(dist, 'database/migrations');
  const result: Record<string, string> = {};
  for (const file of (await fs.readdir(root, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!file.isFile() || file.isSymbolicLink()) throw new Error('Schema expansion requires a flat registry of regular migration files');
    if (file.name === 'index.js' || !file.name.endsWith('.js')) continue;
    const name = file.name.slice(0, -3);
    if (!file.isFile() || file.isSymbolicLink() || !MIGRATION.test(name)) throw new Error('Schema expansion requires a flat registry of regular, numbered migration files');
    result[name] = createHash('sha256').update(await fs.readFile(path.join(root, file.name))).digest('hex');
  }
  return result;
}

export async function schemaDatabaseIdentity(db: Kysely<unknown>): Promise<string> {
  const config = resolveOmnitronPgConfig();
  const observed = await sql<{ database_oid: string; schema_oid: string; database_name: string; schema_name: string }>`
    select d.oid::text as database_oid, n.oid::text as schema_oid,
      current_database() as database_name, current_schema() as schema_name
    from pg_database d cross join pg_namespace n
    where d.datname = current_database() and n.nspname = current_schema()
  `.execute(db);
  if (observed.rows.length !== 1) throw new Error('Cannot identify the migration database and schema');
  return createHash('sha256').update(JSON.stringify({ host: config.host, port: config.port, ...observed.rows[0] })).digest('hex');
}

export function validateSchemaExpansionReceipt(value: unknown): SchemaExpansionReceipt {
  const receipt = value as SchemaExpansionReceipt | null;
  if (!receipt || receipt.protocol !== 1 || !/^[0-9a-f-]{36}$/.test(receipt.id) || receipt.kind !== 'master-expand' ||
      !['approved', 'applied'].includes(receipt.phase) || !path.isAbsolute(receipt.instanceHome ?? '') ||
      !SHA256.test(receipt.fromRuntime) || !SHA256.test(receipt.toRuntime) || receipt.fromRuntime === receipt.toRuntime ||
      !SHA256.test(receipt.database) || !Number.isFinite(Date.parse(receipt.approvedAt)) ||
      (receipt.phase === 'applied' && !Number.isFinite(Date.parse(receipt.appliedAt ?? ''))) ||
      !receipt.baseFiles || Array.isArray(receipt.baseFiles) || Object.keys(receipt.baseFiles).length > 1000 ||
      !Object.entries(receipt.baseFiles).every(([name, digest]) => MIGRATION.test(name) && SHA256.test(digest)) ||
      !Array.isArray(receipt.additions) || receipt.additions.length === 0 || receipt.additions.length > 100 ||
      !receipt.additions.every(m => m && MIGRATION.test(m.name) && SHA256.test(m.fileHash) && SHA256.test(m.checksum) && !Object.hasOwn(receipt.baseFiles, m.name)) ||
      new Set(receipt.additions.map(m => m.name)).size !== receipt.additions.length) {
    throw new Error('Invalid schema expansion receipt');
  }
  return receipt;
}

/** The allowance is exact: one rollback binary, database identity and recorded checksums. */
export function schemaExpansionCovers(receipt: SchemaExpansionReceipt, runtime: string, files: Record<string, string>, database: string, records: MigrationRecord[]): boolean {
  validateSchemaExpansionReceipt(receipt);
  if (receipt.fromRuntime !== runtime || receipt.database !== database) return false;
  const names = Object.keys(files).sort();
  if (names.length !== Object.keys(receipt.baseFiles).length || names.some(name => receipt.baseFiles[name] !== files[name])) return false;
  return records.every(record => typeof record.checksum === 'string' && receipt.additions.some(m => m.name === record.name && m.checksum === record.checksum));
}

/** Read-only compatibility evidence; never repairs history or grants a blanket unknown-migration exception. */
export async function compatibleFutureMigrations(db: Kysely<unknown>, records: MigrationRecord[], context: {
  instanceHome?: string; dist?: string;
} = {}): Promise<string[]> {
  if (records.length === 0) return [];
  const home = context.instanceHome ?? OMNITRON_HOME;
  const indexFile = schemaReceiptIndex(home);
  let index: { protocol: number; receipts: string[] } | null;
  try {
    const stat = await fs.lstat(indexFile);
    if (stat.size > 16 * 1024) throw new Error('Schema compatibility index exceeds its size limit');
    index = await readPrivateRecord(indexFile);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  if (!index || index.protocol !== 1 || !Array.isArray(index.receipts) || index.receipts.length > 64 ||
      !index.receipts.every(id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id)) || new Set(index.receipts).size !== index.receipts.length) {
    throw new Error('Invalid schema compatibility index');
  }
  const dist = context.dist ?? path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const root = path.resolve(dist, '../../..');
  if (dist !== path.join(root, 'packages/0/dist')) throw new Error('Schema compatibility requires an immutable installed runtime');
  const manifest = await verifyRuntimeArtifact(root);
  const [files, database] = await Promise.all([masterMigrationFiles(dist), schemaDatabaseIdentity(db)]);
  for (const id of index.receipts) {
    const file = schemaReceiptFile(home, id);
    const stat = await fs.lstat(file);
    if (stat.size > 512 * 1024) throw new Error('Schema expansion receipt exceeds its size limit');
    const receipt = validateSchemaExpansionReceipt(await readPrivateRecord(file));
    if (receipt.id !== id || receipt.instanceHome !== home) throw new Error('Schema receipt belongs to another instance');
    if (schemaExpansionCovers(receipt, manifest.sha256, files, database, records)) return records.map(row => row.name);
  }
  return [];
}
