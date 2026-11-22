import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { IEcosystemConfig, IStackConfig } from '../config/types.js';
import { publicLaunchFailure } from '../project/launch-failure.js';
import { readBootstrapMetadata, type BootstrapDeclaration } from '../project/bootstrap-metadata.js';
import { readProjectStacks, resolveProjectStacks } from '../config/project-stacks.js';
import { loadEcosystemConfig } from '../config/loader.js';
import { resolveAppPath } from '../config/app-path.js';
import { loadRelease, treeEqualsCommit } from './load.js';
import { definitionInputs } from './definition-inputs.js';

const marker = 'omnitron-source:/';
const maxBytes = 16 * 1024 * 1024;
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

export async function readCapturedSource(store: string, digest: string, source: string): Promise<CapturedSource> {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw Error('An exact producer declaration digest is required');
  const file = path.join(store, '.remote-sources', digest + '.json');
  if (await fs.realpath(file) !== file) throw Error('Producer declarations must be a physical file');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.size > maxBytes) throw Error('Invalid producer declaration file');
    const bytes = await handle.readFile();
    if (bytes.length !== st.size || sourceFileDigest(bytes) !== digest) throw Error('Producer declaration digest differs');
    return JSON.parse(bytes.toString('utf8'), (_key, value: unknown) => resolveSourceValue(source, value));
  } finally { await handle.close(); }
}

async function captureDeclarations(root: string, project: string, name: string, bindings: Record<string, string>, scratch: string) {
  const isolated = { cwd: root, env: { ...bindings, PATH: process.env['PATH'], HOME: scratch, TMPDIR: scratch,
    LANG: 'C', TZ: 'UTC', CI: 'true', NODE_ENV: 'production', TSX_DISABLE_CACHE: '1' } };
  const config = await loadEcosystemConfig(root, 'release', { isolated }).catch(error => {
    throw Error('Release ecosystem evaluation failed in the isolated producer: ' + publicLaunchFailure(error));
  });
  const stack = resolveProjectStacks(config, root, project)[name];
  if (stack?.type !== 'remote') throw Error('Producer capture requires a declared remote stack');
  const apps = sourceStackApps(config, stack);
  const bootstraps = apps.flatMap(app => app.bootstrap ? [resolveAppPath(root, app, app.bootstrap)] : []);
  await definitionInputs(root, bootstraps);
  const declarations: CapturedSource['declarations'] = [];
  for (const app of apps) {
    for (const [key, value] of Object.entries(bindings)) {
      const binding = stack.settings?.appEnv?.[app.name]?.[key] ?? stack.settings?.env?.[key];
      // These exact fields are supplied by the selected stack's runtime binding.
      if (app.env && app.env[key] === value && binding && typeof binding === 'object' && typeof binding.secret === 'string')
        delete app.env[key];
    }
    if (!app.bootstrap) continue;
    const bootstrap = resolveAppPath(root, app, app.bootstrap);
    const { metadata } = await readBootstrapMetadata(bootstrap, true, 30_000, undefined, isolated).catch(error => {
      throw Error('Release bootstrap evaluation failed for ' + app.name + ': ' + publicLaunchFailure(error));
    });
    declarations.push({ app: app.name, bootstrap, sha256: metadata.source.sha256, definition: metadata.definition });
  }
  return { stackOrigin: Object.hasOwn(config.stacks ?? {}, name) ? 'ecosystem' as const : 'stacks-file' as const,
    config: { ...config, apps, stacks: { [name]: stack } }, declarations };
}

/** Producer-only command. The controller consumes this data without executing a project
 * factory or bootstrap. The qualified checkout must already have its build dependencies. */
export async function captureRemoteSource(project: string, stack: string, releaseId: string, root: string, store: string) {
  const source = await fs.realpath(root), storeRoot = await fs.realpath(store);
  const release = await loadRelease(releaseId, storeRoot), commit = release.manifest.project.commit;
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const git = async (...args: string[]) => (await promisify(execFile)('git', ['-C', source, ...args])).stdout.trimEnd();
  const verify = async () => {
    if (await git('rev-parse', 'HEAD') !== commit || (await git('rev-parse', '--show-prefix')).replace(/\/$/, '') !== (release.manifest.project.directory ?? '') ||
        !(await treeEqualsCommit(source, commit)).equal) throw Error('Producer checkout differs from the release project commit');
  };
  await verify();
  await definitionInputs(source, []);
  const settings = readProjectStacks(path.join(source, 'omnitron.stacks.json'), project)[stack]?.settings;
  const names = new Set<string>();
  for (const environment of [settings?.env, ...Object.values(settings?.appEnv ?? {})])
    for (const [key, value] of Object.entries(environment ?? {}))
      if (value && typeof value === 'object' && typeof value.secret === 'string') names.add(key);
  const scratch = await fs.mkdtemp(path.join(os.tmpdir(), 'omnitron-release-source-'));
  try {
    const serialize = async () => {
      const bindings: Record<string, string> = Object.fromEntries([...names].map(key => [key, 'omnitron-capture-' + randomBytes(24).toString('hex')]));
      const payload = await captureDeclarations(source, project, stack, bindings, scratch);
      const capture: CapturedSource = { protocol: 1, project, stack, release: release.id, commit, manifestSha256: release.manifestSha256, ...payload };
      const bytes = Buffer.from(JSON.stringify(capture, (_key, value: unknown) => portableSourceValue(source, value)));
      if (bytes.length > maxBytes || Object.values(bindings).some(value => bytes.includes(Buffer.from(value))))
        throw Error('Release source contains unresolved synthetic values or exceeds its size limit');
      return bytes;
    };
    const bytes = await serialize();
    // A configuration that transforms a secret into a topology field is not portable.
    if (names.size && !(await serialize()).equals(bytes)) throw Error('Producer declarations depend on runtime bindings');
    await verify();
    const digest = sourceFileDigest(bytes), directory = path.join(storeRoot, '.remote-sources');
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (await fs.realpath(directory) !== directory) throw Error('Producer declaration directory must be physical');
    const temporary = path.join(directory, '.capture-' + randomBytes(16).toString('hex')), file = path.join(directory, digest + '.json');
    await fs.writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
    try {
      try { await fs.link(temporary, file); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error; }
      await readCapturedSource(storeRoot, digest, source);
    } finally { await fs.unlink(temporary); }
    return { project, stack, release: release.id, commit, manifestSha256: release.manifestSha256, declarationsSha256: digest, file };
  } finally { await fs.rm(scratch, { recursive: true, force: true }); }
}

/** Restrict projection to this logical stack and its eligible applications. */
export function sourceStackApps(config: IEcosystemConfig, stack: IStackConfig) {
  return config.apps.filter(entry => entry.enabled !== false && (!Array.isArray(stack.apps) || stack.apps.includes(entry.name)));
}
