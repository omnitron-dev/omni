import { assertRepositoryIdentity } from '../release/repository-identity.js';

/** An operator-selected Git source. No hosting provider or branch is implicit. */
export interface FrameworkSource {
  readonly repository: string;
  readonly ref?: string;
}

export function isFrameworkRef(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 1024 && /^refs\/(?:heads|tags)\/.+/.test(value) &&
    !/[\x00-\x20\x7f~^:?*[\\]/.test(value) && !value.includes('..') && !value.includes('@{') &&
    !value.endsWith('.') && value.split('/').every(part => part && !part.startsWith('.') && !part.endsWith('.lock'));
}

/** Shared by CLI, RPC and browser forms; invalid explicit inputs never fall back. */
export function parseFrameworkSource(value: unknown): FrameworkSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Framework source must contain a repository and an optional full Git ref');
  const source = value as Record<string, unknown>;
  if (Object.keys(source).some(key => key !== 'repository' && key !== 'ref')) throw Error('Unknown framework source option');
  assertRepositoryIdentity(source['repository']);
  if (source['repository'] === '(no origin)') throw Error('Framework source requires a repository');
  if (source['ref'] !== undefined && !isFrameworkRef(source['ref'])) throw Error('Framework ref must be a full refs/heads/ or refs/tags/ name');
  return Object.freeze({ repository: source['repository'], ...(source['ref'] === undefined ? {} : { ref: source['ref'] }) });
}

/** package.json's conventional Git transport prefix does not select a hosting provider. */
export function frameworkRepositoryMetadata(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  const repository = typeof value === 'string' ? value : value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)['url'] : undefined;
  return parseFrameworkSource({ repository }).repository;
}
