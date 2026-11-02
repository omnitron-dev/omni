/** Xec extracts the exact revision into a private directory. Attach the original
 * Git identity so the backend and Console embed the same verifiable provenance. */
import path from 'node:path';
import { existsSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const [source, commit] = process.argv.slice(2);
const destination = realpathSync(process.cwd());
if (!source || !/^[a-f\d]{40}$/.test(commit) || realpathSync(source) === destination ||
    existsSync(path.join(destination, '.git'))) throw new Error('Expected an isolated source export and full commit');

const git = (...args) => execFileSync('git', args, { cwd: destination, encoding: 'utf8' }).trim();
git('init', '--quiet');
git('fetch', '--quiet', '--depth=1', '--no-tags', '--', realpathSync(source), commit);
if (git('rev-parse', 'FETCH_HEAD') !== commit) throw new Error('Release source identity differs');
git('update-ref', 'HEAD', commit);
git('read-tree', commit);
if (git('status', '--porcelain')) throw new Error('Exported source differs from the release commit');
execFileSync('pnpm', ['run', 'build'], { cwd: destination, stdio: 'inherit' });
