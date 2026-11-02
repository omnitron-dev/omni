// Runs under the pinned deployment lease using the serving managed runtime's Node.
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const [phase, registry, current, receipt] = process.argv.slice(1);
const build = JSON.parse(receipt);
const sha256 = /^[a-f0-9]{64}$/;
if (!['prepare', 'install'].includes(phase) || !sha256.test(current) || !sha256.test(build.artifact) ||
    !sha256.test(build.archive) || !/^[a-f0-9]{40}$/.test(build.commit) || !Number.isSafeInteger(build.bytes) ||
    build.bytes <= 0 || build.bytes > 2 * 1024 ** 3 || build.platform !== process.platform ||
    build.arch !== process.arch || build.nodeVersion !== process.version) throw Error('Unexpected distribution target or artifact identity');
const root = path.join(registry, 'releases', current);
if (path.basename(registry) !== 'runtime' || await fs.realpath(registry) !== registry ||
    await fs.realpath(process.execPath) !== path.join(root, 'node')) throw Error('Invalid receiver runtime');
const home = path.dirname(registry);
const pkg = path.join(root, 'packages/0');
const sdk = relative => import(pathToFileURL(path.join(pkg, 'dist', relative + '.js')).href);
const { RuntimeInstallation } = await sdk('daemon/runtime-installation');
const { verifyRuntimeArtifact } = await sdk('shared/runtime-artifact');
const { readBuildStamp } = await sdk('shared/build-stamp');
const { readManagedRuntime } = await sdk('daemon/managed-runtime');
const { privateControlClient } = await sdk('daemon/private-control-client');
const config = await readManagedRuntime(home);
if (!config) throw Error('No managed supervisor for this instance');
const channel = await privateControlClient(path.join(config.directory, 'supervisor.sock'), 'OmnitronSupervisor');
try {
  const state = await channel.service.status();
  if (state.kernelHandoff !== 1 || state.operationPending !== false || state.state !== 'ready') {
    throw Error('The native guardian must be ready and support kernelHandoff@1 before distributing an update');
  }
} finally { await channel.close(); }
const installation = await RuntimeInstallation.open(home, { existing: true });
if (!installation) throw Error('Missing runtime installation');
const inbox = path.join(registry, '.incoming-' + build.artifact);
const archive = path.join(inbox, 'runtime.tgz');
const confirmSelection = () => {
  if (installation.selection()?.current !== current || installation.activation()) throw Error('Runtime selection changed during staging');
};
const present = async () => {
  try { await fs.lstat(installation.releasePath(build.artifact)); }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  const found = await installation.artifact(build.artifact);
  if (found.build.commit !== build.commit) throw Error('Installed source differs from catalog receipt');
  return true;
};
const capacity = async bytes => {
  const disk = await fs.statfs(registry);
  if (disk.bavail * disk.bsize < bytes + 256 * 1024 ** 2) throw Error('Insufficient free space to stage and install the candidate');
};
const resetInbox = async () => {
  // Only this digest's unpublished transfer directory is disposable. The remote
  // command guard excludes concurrent stage/cleanup for an expired lease.
  const prior = await fs.lstat(inbox).catch(err => { if (err.code !== 'ENOENT') throw err; });
  if (prior) {
    if (!prior.isDirectory() || prior.uid !== process.getuid() || prior.mode & 0o077 || await fs.realpath(inbox) !== inbox) throw Error('Unsafe kernel transfer directory');
    await fs.rm(inbox, { recursive: true });
  }
};
try {
  confirmSelection();
  let installed = await present();
  if (installed || phase === 'prepare') await resetInbox();
  if (!installed && phase === 'prepare') {
    await capacity(build.bytes);
    await fs.mkdir(inbox, { mode: 0o700 });
  } else if (!installed) {
    const dir = await fs.lstat(inbox), file = await fs.lstat(archive);
    if (!dir.isDirectory() || dir.uid !== process.getuid() || dir.mode & 0o077 || await fs.realpath(inbox) !== inbox ||
        !file.isFile() || file.nlink !== 1 || file.uid !== process.getuid() || file.mode & 0o022 || file.size !== build.bytes) throw Error('Unsafe or incomplete kernel transfer');
    try {
      const sum = createHash('sha256');
      for await (const chunk of createReadStream(archive)) sum.update(chunk);
      if (sum.digest('hex') !== build.archive) throw Error('Kernel transfer SHA-256 mismatch');
      const tar = createRequire(path.join(pkg, 'package.json'))('tar');
      let expanded = 0, invalid = false;
      const entries = new Map();
      await tar.list({ file: archive, strict: true, onReadEntry(entry) {
        const name = entry.path.replace(/\/$/, '');
        if (!name || name.includes('\0') || name.startsWith('/') || name.split('/').some(s => !s || s === '.' || s === '..') ||
            !['File','Directory','SymbolicLink'].includes(entry.type) || entries.has(name) || entries.size >= 200_000) { invalid = true; return; }
        if (entry.type === 'SymbolicLink') {
          const destination = path.join(path.dirname(name), entry.linkpath);
          if (!entry.linkpath || path.isAbsolute(entry.linkpath) || destination === '..' || destination.startsWith('../')) invalid = true;
        }
        expanded += entry.size;
        entries.set(name, entry.type);
      } });
      for (const name of entries.keys()) {
        const parent = path.dirname(name);
        if (parent !== '.' && entries.get(parent) !== 'Directory') invalid = true;
      }
      if (invalid || expanded > 8 * 1024 ** 3) throw Error('Kernel archive exceeds limits or contains an unsafe entry');
      await capacity(2 * expanded);
      const payload = path.join(inbox, 'payload');
      await fs.mkdir(payload, { mode: 0o700 });
      await tar.extract({ file: archive, cwd: payload, strict: true, preserveOwner: false, preservePaths: false,
        chmod: true, umask: 0o022, dmode: 0o700, fmode: 0o600 });
      const manifest = await verifyRuntimeArtifact(payload, build.artifact);
      const stamp = readBuildStamp(path.join(payload, 'packages/0/dist'));
      if (manifest.nodeVersion !== build.nodeVersion || stamp?.commit !== build.commit || stamp.dirty !== false) throw Error('Received runtime identity differs from catalog receipt');
      await installation.exclusive(async () => {
        confirmSelection();
        const result = await installation.install(payload);
        if (result.runtimeHash !== build.artifact || result.build.commit !== build.commit) throw Error('Installed runtime differs from catalog receipt');
      });
      installed = true;
    } finally { await resetInbox(); }
  }
  console.log(JSON.stringify({ installed, artifact: build.artifact }));
} finally { await installation.close(); }
