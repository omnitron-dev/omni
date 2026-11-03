import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { list } from 'tar';
import { parseDeclaredConfig, type DeclaredConfig } from '../project/declared-config.js';
import type { LoadedRelease } from './load.js';

const canonical = 'config/default.json';

/** Read only regular, uniquely named declaration inputs from the very bytes whose digest
 * was admitted. Application JavaScript is never imported and the rest of the config stays private. */
export async function readArchiveInfrastructure(release: LoadedRelease, app: string): Promise<DeclaredConfig> {
  const file = release.files.find((candidate) => candidate.app === app);
  if (!file || !/^[a-f0-9]{64}$/.test(file.sha256)) throw Error('Missing verified release archive for ' + app);
  const expected = path.join(await fs.realpath(release.root), 'artifacts', app + '-' + file.version + '.tar.gz');
  if ((await fs.realpath(file.path)) !== expected) throw Error('Infrastructure archive leaves its admitted release');
  const handle = await fs.open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size !== file.bytes) throw Error('Infrastructure archive size changed for ' + app);
    const chunks: Buffer[] = [];
    const seen = new Set<string>();
    let invalid = false;
    const parser = list({
      strict: true,
      onReadEntry(entry) {
        const raw = entry.path.replace(/^\.\//, '').replace(/\/$/, '');
        const normalized = path.posix.normalize(raw).normalize('NFC').toLowerCase();
        if (normalized !== canonical && normalized !== 'config') return;
        const directory = normalized === 'config';
        if (
          normalized !== raw ||
          seen.has(normalized) ||
          entry.type !== (directory ? 'Directory' : 'File') ||
          entry.size > 1_048_576 ||
          entry.size < 0
        ) {
          invalid = true;
          return;
        }
        seen.add(normalized);
        if (!directory) entry.on('data', (part: Buffer) => chunks.push(part));
      },
    });
    const finished = once(parser, 'end');
    const input = handle.createReadStream({ autoClose: false });
    const hash = createHash('sha256');
    try {
      input.on('data', (part) => hash.update(part));
      input.on('error', (error) => parser.abort(error));
      input.pipe(parser);
      await finished;
    } finally {
      input.destroy();
    }
    if (hash.digest('hex') !== file.sha256) throw Error('Infrastructure archive changed for ' + app);
    if (invalid) throw Error('Package ' + app + ' must supply config/default.json as a unique physical file of at most 1 MiB');
    if (!seen.has(canonical)) return { configPath: canonical };
    const declaration = parseDeclaredConfig(Buffer.concat(chunks).toString('utf8'), canonical);
    if (declaration.malformed) throw Error('Malformed archived ' + canonical + ' for ' + app);
    return { configPath: canonical, ...(declaration.omnitron && { omnitron: declaration.omnitron }) };
  } finally {
    await handle.close();
  }
}
