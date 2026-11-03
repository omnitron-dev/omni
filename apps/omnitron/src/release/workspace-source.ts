import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** The registration selects a config; its nearest committed pnpm lock selects the build workspace. */
export async function releaseWorkspaceDirectory(repository: string, commit: string, configuration: string): Promise<string> {
  if (!/^[a-f0-9]{40}$/.test(commit) || (configuration && (configuration.includes('\\') ||
    configuration.split('/').some(s => !s || s === '.' || s === '..')))) throw Error('Invalid release source location');
  const candidates = [];
  for (let dir = configuration; ; dir = path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir)) {
    candidates.push(path.posix.join(dir, 'pnpm-lock.yaml'));
    if (!dir) break;
  }
  const { stdout } = await exec('git', ['--literal-pathspecs', 'ls-tree', '-z', '--full-tree', commit, '--', ...candidates], { cwd: repository });
  const blobs = stdout.split('\0').filter(Boolean).map(line => {
    const tab = line.indexOf('\t'); return [line.slice(tab + 1), line.slice(0, tab)] as const;
  });
  const files = new Map(blobs);
  for (const file of candidates) {
    const object = files.get(file);
    if (object === undefined) continue;
    if (!/^100(?:644|755) blob [a-f0-9]{40}$/.test(object)) throw Error('Release lock must be a regular committed file: ' + file);
    const dir = path.posix.dirname(file);
    return dir === '.' ? '' : dir;
  }
  throw Error('No committed pnpm-lock.yaml for configuration ' + (configuration || '.') + ' at ' + commit);
}
