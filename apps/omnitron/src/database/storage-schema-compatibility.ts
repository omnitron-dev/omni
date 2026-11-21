import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

/** Compiled bodies from the reviewed 017/001 rollback writer and 018/002 release.
 * Ordinary artifact verification authenticates the enclosing release. These pins additionally distinguish
 * the rollback worker that understands provenance from an older release with the very same registries. */
const writerModules = [
  'database/alert-bridge/layout.js', 'database/alert-bridge/node-history.js', 'cluster/slave-connector.js',
  'services/sync.service.js', 'services/alert.service.js', 'services/slave-storage.service.js', 'services/host-storage-alert.js',
];
const writerDigest = '0b8b6e4ceb08586eda01f1ebfffa521fe609f0a2438390ace2f79e40e029a150';
export const STORAGE_EXPANSION = {
  masterName: '018_host_storage_alert',
  masterChecksum: '60a0c65ce23823b38676cef63d0c90b0b3fa7d56b021c6467c9a8831cbcfbb41',
  masterBody: 'e058fd1965cdc79f92a4511260ee3445801e217e38d13b9287debcfda17989db',
  masterIndex017: 'fb941e846789f309bf12c28d06f9f36900148f39713d52cbb986f7571349f1dc',
  masterIndex018: '0dfa857a7a7f1099df587d24c30d9a67550d30b79488c11da2ffc3edffb311e1',
  nodeBody001: '6c705fd9b57b3f863cf07bf67a1865f7691f8831fe1fc030244f5fb829f3ac98',
  nodeBody002: '2047b5eef96ecee990f978a408e8ac9aa4058154e29f61004a20b7803bd5908a',
  nodeIndex001: 'f147526a0d240293c2d87ef19fa28f0a96455f2a7df97707dd6d882ed9805700',
  nodeIndex002: '1e78bc1567bd8450b3a0670aa10a85ba4644b3208332bb5518c1fcba06d9fc3f',
} as const;

async function fileHash(file: string) {
  if (!(await fs.lstat(file)).isFile()) throw Error('Reviewed schema code must be a regular file');
  return createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

export async function hasStorageRollbackWriter(directory: string): Promise<boolean> {
  try {
    const hashes = await Promise.all(writerModules.map(name => fileHash(path.join(directory, name))));
    const digest = createHash('sha256');
    writerModules.forEach((name, index) => digest.update(JSON.stringify([name, hashes[index]])));
    return digest.digest('hex') === writerDigest;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function hasReviewedStorageBody(directory: string): Promise<boolean> {
  return await fileHash(path.join(directory, 'database/migrations', STORAGE_EXPANSION.masterName + '.js')) === STORAGE_EXPANSION.masterBody;
}

interface MigrationTree {
  directories: string[];
  files: Map<string, { hash: string }>;
}

/** Both directions must identify the actual 001 rollback writer, all of SQLite, and the shared rule
 * definitions imported by 002. Enrolled workers additionally retain every unrelated authority migration. */
export async function reviewedNodeStorageExpansion(
  older: MigrationTree, newer: MigrationTree, rollback: string, target: string, enrolled: boolean,
): Promise<boolean> {
  const p = STORAGE_EXPANSION;
  const directories = enrolled ? ['master', 'node'] : ['node'];
  if (JSON.stringify(older.directories) !== JSON.stringify(directories) ||
      JSON.stringify(newer.directories) !== JSON.stringify(directories)) return false;
  const nodes = (tree: MigrationTree) => [...tree.files.keys()].filter(key => key.startsWith('node/')).length;
  if (nodes(older) !== 2 || nodes(newer) !== 3 ||
      older.files.get('node/index.js')?.hash !== p.nodeIndex001 || newer.files.get('node/index.js')?.hash !== p.nodeIndex002 ||
      older.files.get('node/001_replication_evidence.js')?.hash !== p.nodeBody001 ||
      newer.files.get('node/001_replication_evidence.js')?.hash !== p.nodeBody001 ||
      newer.files.get('node/002_host_storage_alert.js')?.hash !== p.nodeBody002) return false;
  if (enrolled && (older.files.get('master/index.js')?.hash !== p.masterIndex017 ||
      newer.files.get('master/index.js')?.hash !== p.masterIndex018 ||
      newer.files.get('master/018_host_storage_alert.js')?.hash !== p.masterBody ||
      newer.files.size !== older.files.size + 2 ||
      [...older.files].some(([name, file]) => name.startsWith('master/') && name !== 'master/index.js' &&
        newer.files.get(name)?.hash !== file.hash))) return false;
  return await hasStorageRollbackWriter(rollback) && await hasReviewedStorageBody(target);
}
