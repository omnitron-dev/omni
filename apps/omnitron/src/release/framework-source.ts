import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { frameworkRepositoryMetadata, parseFrameworkSource, type FrameworkSource } from '../shared/framework-source.js';
import { networkRepository, sourceRefContains } from './source.js';
import { sourcePublication } from './source.js';
import type { ReleaseSource } from './manifest.js';

export type FrameworkStep = (command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<void>;

/** Read only committed project metadata, supplied by the build's exact Git snapshot. */
export function projectFrameworkSource(manifest: unknown, override?: unknown): FrameworkSource | undefined {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw Error('Committed package.json must be an object');
  const project = manifest as { omnitron?: { framework?: unknown } };
  if (project.omnitron !== undefined && (!project.omnitron || typeof project.omnitron !== 'object' || Array.isArray(project.omnitron)))
    throw Error('Committed package.json omnitron configuration must be an object');
  const selected = override === undefined ? project.omnitron?.framework : override;
  return selected === undefined ? undefined : parseFrameworkSource(selected);
}

export function assertFrameworkInput(manifest: { omnitron?: { release?: { frameworkInput?: unknown } } }, layout: string): void {
  const required = manifest.omnitron?.release?.frameworkInput;
  if (required === undefined) return;
  if (required !== 'registry') throw Error('Unsupported omnitron.release.frameworkInput. Use registry or omit the setting.');
  if (layout !== required) throw Error('This project requires npm registry framework inputs for releases. Commit the published versions and their frozen registry lockfile.');
}

/** A legacy package may omit repository metadata. The packager's own declared
 * package metadata is the compatibility default, not a provider encoded in code. */
export function defaultFrameworkSource(repository?: unknown): FrameworkSource {
  const declared = frameworkRepositoryMetadata(repository);
  if (declared) return parseFrameworkSource({ repository: declared });
  const own = JSON.parse(fs.readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { repository?: unknown };
  const fallback = frameworkRepositoryMetadata(own.repository);
  if (!fallback) throw Error('Configure omnitron.framework.repository; the framework package has no repository metadata');
  return parseFrameworkSource({ repository: fallback });
}

/** Preserve recorded identity while resolving local inputs against the selected project. */
export function frameworkRepositoryLocation(repository: string, projectDirectory: string): string {
  if (networkRepository(repository) || repository.startsWith('file://')) return repository.replace(/^git\+(?=(?:https?|ssh):\/\/)/, '');
  return repository.startsWith('~/') ? path.join(os.homedir(), repository.slice(2)) : path.resolve(projectDirectory, repository);
}

export async function requireFrameworkRef(checkout: string, source: FrameworkSource, commit: string,
  location: string, signal?: AbortSignal): Promise<void> {
  if (source.ref && await sourceRefContains(checkout, location, commit, source.ref, signal) !== true)
    throw Error('The selected framework ref does not prove the requested commit; verify source access and the exact ref');
}

/** One source-selection path for linked SDKs, archive reproduction and an explicit
 * registry ref constraint. The clone is visible in the build's normal progress/logs. */
export async function checkoutFrameworkSource(destination: string, options: {
  source: FrameworkSource; commit: string; sourceBase: string; env: NodeJS.ProcessEnv;
  run: FrameworkStep; signal?: AbortSignal;
}): Promise<ReleaseSource> {
  const { commit, sourceBase, signal, run } = options;
  const source = parseFrameworkSource(options.source);
  const location = frameworkRepositoryLocation(source.repository, sourceBase);
  const env = { ...options.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' };
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  signal?.throwIfAborted();
  await run('git', ['clone', '--no-checkout', '--', location, destination], path.dirname(destination), env);
  await run('git', ['checkout', '--detach', commit], destination, env);
  await requireFrameworkRef(destination, source, commit, location, signal);
  return { repo: source.repository, commit, ...(source.ref && { ref: source.ref }),
    onRemote: await sourcePublication(destination, location, commit, { ...(source.ref && { ref: source.ref }), ...(signal && { signal }) }) };
}
