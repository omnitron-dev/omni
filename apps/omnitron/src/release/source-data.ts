import { createHash } from 'node:crypto';
import sync, { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { IEcosystemConfig } from '../config/types.js';
import type { BootstrapDeclaration } from '../project/bootstrap-metadata.js';

const marker = 'omnitron-source:/';
export const maxBytes = 16 * 1024 * 1024;
export const sourceFileDigest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
export interface CapturedSource {
  protocol: 1; project: string; stack: string; release: string; commit: string; manifestSha256: string;
  stackOrigin: 'stacks-file' | 'ecosystem'; config: IEcosystemConfig; declarations: Array<{ app: string; bootstrap: string; sha256: string; definition: BootstrapDeclaration }>;
}

export function portableSourceValue(root: string, value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (value.startsWith(marker)) throw Error('Reserved source path in deployment declaration');
  if (value === root || value.startsWith(root + path.sep))
    return marker + path.relative(root, value).split(path.sep).join('/');
  if (value.includes(root + path.sep)) throw Error('An embedded producer path cannot be relocated');
  return value;
}

export function resolveSourceValue(root: string, value: unknown): unknown {
  if (typeof value !== 'string' || !value.startsWith(marker)) return value;
  const relative = value.slice(marker.length);
  if (relative && (relative.split('/').some(part => !part || part === '..' || part === '.') || relative.includes('\\') || relative.includes('\0')))
    throw Error('Invalid captured source path');
  return path.join(root, relative);
}

function captureFile(store: string, digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('An exact producer declaration digest is required');
  return path.join(store, '.remote-sources', digest + '.json');
}
function capturedBytes(bytes: Buffer, size: number, digest: string, source: string): CapturedSource {
  if (bytes.length !== size || sourceFileDigest(bytes) !== digest) throw Error('Producer declaration digest differs');
  return JSON.parse(bytes.toString('utf8'), (_key, value: unknown) => resolveSourceValue(source, value));
}
/** Synchronous status readers load this bounded immutable data once per selection. */
export function readCapturedSourceSync(store: string, digest: string, source: string): CapturedSource {
  const file = captureFile(store, digest);
  if (sync.realpathSync(file) !== file) throw Error('Producer declarations must be a physical file');
  const fd = sync.openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = sync.fstatSync(fd);
    if (!st.isFile() || st.size > maxBytes) throw Error('Invalid producer declaration file');
    return capturedBytes(sync.readFileSync(fd), st.size, digest, source);
  } finally { sync.closeSync(fd); }
}
export async function readCapturedSource(store: string, digest: string, source: string): Promise<CapturedSource> {
  const file = captureFile(store, digest);
  if (await fs.realpath(file) !== file) throw Error('Producer declarations must be a physical file');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > maxBytes) throw Error('Invalid producer declaration file');
    return capturedBytes(await handle.readFile(), st.size, digest, source);
  } finally { await handle.close(); }
}
