// Minimal trusted launcher: verify bytes before importing the runtime closure.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuntimeArtifact } from '../shared/runtime-artifact.js';

const mode = process.argv[2];
if (mode !== 'owner' && mode !== 'backend') throw new Error('Expected an owner or backend OS service entry');
const home = path.resolve(process.env['OMNITRON_HOME'] ?? path.join(os.homedir(), '.omnitron'));
const file = path.join(home, 'runtime', 'supervision.json');
const stat = await fs.lstat(file);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024 * 1024 || (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())) throw new Error('Supervision configuration must be private and bounded');
const config = JSON.parse(await fs.readFile(file, 'utf8')) as { owner?: { artifact?: string }; backend?: { artifact?: string } };
const id = config[mode]?.artifact;
if (!id || !/^[a-f0-9]{64}$/.test(id)) throw new Error('Invalid supervised runtime identity');
const root = path.join(home, 'runtime', 'releases', id);
const manifest = await verifyRuntimeArtifact(root, id);
if (manifest.nodeVersion !== process.version || await fs.realpath(process.execPath) !== path.join(await fs.realpath(root), 'node')) {
  throw new Error('The OS service must use the Node binary sealed with its pinned runtime');
}
// Configuration files can be TypeScript. Install the verified loader only
// after integrity validation, never through an unverified --import preload.
(await import('tsx/esm/api')).register();
await import(pathToFileURL(path.join(root, 'packages/0/dist/daemon', mode === 'owner' ? 'managed-owner-entry.js' : 'backend-supervisor-entry.js')).href);
