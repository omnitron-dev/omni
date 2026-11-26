// Runs under the pinned deployment lease using the serving managed runtime's Node.
import fs from 'node:fs/promises';
import { constants, createReadStream, fstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [phase, registry, current, receipt, expectedRevision] = process.argv.slice(1);
const build = JSON.parse(receipt);
const progress = name => process.stderr.write('omnitron.kernel.stage ' + name + '\n');
const sha256 = /^[a-f0-9]{64}$/;
if (!['prepare', 'install', 'observe'].includes(phase) || !sha256.test(current) || !sha256.test(build.artifact) ||
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
const { inspectRuntimeArtifact, readRuntimeManifest } = await sdk('shared/runtime-artifact');
const { checkBackendCandidate } = await sdk('daemon/backend-candidate');
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
const installation = phase === 'observe' ? await RuntimeInstallation.openReadOnly(home) : await RuntimeInstallation.open(home, { existing: true });
if (!installation) throw Error('Missing runtime installation');
const inbox = path.join(registry, '.incoming-' + build.artifact);
const confirmSelection = () => {
  const selected = phase === 'observe' ? installation.settledSelection() : installation.selection();
  if (selected?.current !== current || installation.activation() ||
      (expectedRevision !== undefined && String(selected.revision) !== expectedRevision)) throw Error('Runtime selection changed during staging');
  return selected.revision;
};
const present = async () => {
  const release = installation.releasePath(build.artifact);
  try {
    if (!(await fs.lstat(release)).isDirectory()) throw Error('Installed runtime must be a physical directory');
  }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  if (phase === 'observe') {
    if (await fs.realpath(release) !== release) throw Error('Installed runtime path changed');
    const proof = await inspectRuntimeArtifact(release, build.artifact);
    const stamp = readBuildStamp(path.join(release, 'packages/0/dist'));
    if (stamp?.commit !== build.commit || stamp.dirty !== false || proof.manifest.nodeVersion !== build.nodeVersion)
      throw Error('Installed runtime differs from catalog receipt');
    await proof.assertUnchanged();
    return true;
  }
  const found = await installation.artifact(build.artifact);
  if (found.build.commit !== build.commit) throw Error('Installed source differs from catalog receipt');
  // A previous receiver may have stopped between rename and the parent flush.
  await syncRuntimeEntries([installation.releases], true);
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
  const revision = confirmSelection();
  let installed = await present();
  if (phase !== 'observe' && (installed || phase === 'prepare')) await resetInbox();
  if (!installed && phase === 'prepare') {
    await capacity(build.bytes);
    await fs.mkdir(inbox, { mode: 0o700 });
  } else if (!installed && phase === 'install') {
    const dir = await fs.lstat(inbox), file = fstatSync(0);
    if (!dir.isDirectory() || dir.uid !== process.getuid() || dir.mode & 0o077 || await fs.realpath(inbox) !== inbox ||
        !file.isFile() || file.nlink !== 1 || ![0, process.getuid()].includes(file.uid) || file.mode & 0o077 ||
        file.size !== build.bytes) throw Error('Unsafe or incomplete kernel transfer');
    // Positioned reads reuse the same private, seekable descriptor even after
    // the irreversible UID change. The receiver never opens an administrative path.
    const archive = () => createReadStream(null, { fd: 0, start: 0, autoClose: false });
    try {
      progress('archive-digest');
      const sum = createHash('sha256');
      for await (const chunk of archive()) sum.update(chunk);
      if (sum.digest('hex') !== build.archive) throw Error('Kernel transfer SHA-256 mismatch');
      const tar = await loadRuntimeExtractor(pkg);
      progress('archive-inventory');
      let expanded = 0, invalid = false;
      const entries = new Map();
      await pipeline(archive(), tar.list({ strict: true, onReadEntry(entry) {
        const name = entry.path.replace(/\/$/, '');
        if (!name || name.includes('\0') || name.startsWith('/') || name.split('/').some(s => !s || s === '.' || s === '..') ||
            !['File','Directory','SymbolicLink'].includes(entry.type) || entries.has(name) || entries.size >= 200_000) { invalid = true; return; }
        if (entry.type !== 'SymbolicLink' && (!Number.isInteger(entry.mode) || entry.mode & 0o7022)) invalid = true;
        if (entry.type === 'SymbolicLink') {
          const destination = path.join(path.dirname(name), entry.linkpath);
          if (!entry.linkpath || path.isAbsolute(entry.linkpath) || destination === '..' || destination.startsWith('../')) invalid = true;
        }
        expanded += entry.size;
        entries.set(name, { type: entry.type, mode: entry.mode });
      } }));
      for (const name of entries.keys()) {
        const parent = path.dirname(name);
        if (parent !== '.' && entries.get(parent)?.type !== 'Directory') invalid = true;
      }
      if (invalid || expanded > 8 * 1024 ** 3) throw Error('Kernel archive exceeds limits or contains an unsafe entry');
      await capacity(expanded);
      const payload = path.join(inbox, 'payload');
      await fs.mkdir(payload, { mode: 0o700 });
      progress('extract');
      await pipeline(archive(), tar.extract({ cwd: payload, strict: true, preserveOwner: false, preservePaths: false,
        chmod: true, umask: 0o022, dmode: 0o700, fmode: 0o600 }));
      // tar's chmod option does not restore modes of newly created regular files.
      // A receiver running with umask 077 must retain the sealed executable bits.
      // Restore only validated regular entries inside the private transfer directory;
      // never relax the receiver's process-wide umask or follow an archive link here.
      progress('file-modes');
      const files = [...entries].filter(([, entry]) => entry.type === 'File');
      for (let offset = 0; offset < files.length; offset += 16) {
        const results = await Promise.allSettled(files.slice(offset, offset + 16).map(async ([name, entry]) => {
          const file = path.join(payload, name);
          const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || await fs.realpath(file) !== file)
              throw Error('Unsafe extracted kernel file: ' + name);
            if ((stat.mode & 0o777) !== (entry.mode & 0o777)) await handle.chmod(entry.mode & 0o777);
          } finally { await handle.close(); }
        }));
        const failed = results.find(result => result.status === 'rejected');
        if (failed) throw failed.reason;
      }
      const manifest = await readRuntimeManifest(payload);
      const stamp = readBuildStamp(path.join(payload, 'packages/0/dist'));
      if (manifest.sha256 !== build.artifact || manifest.nodeVersion !== build.nodeVersion ||
          stamp?.commit !== build.commit || stamp.dirty !== false) throw Error('Received runtime identity differs from catalog receipt');
      await installation.exclusive(async () => {
        confirmSelection();
        if (await present()) return;
        progress('candidate-verification');
        const candidate = await checkBackendCandidate(path.join(payload, 'packages/0/dist'), undefined, build.artifact);
        if (candidate.runtimeHash !== build.artifact || candidate.build.commit !== build.commit) throw Error('Candidate differs from catalog receipt');
        // The receiver owns this private extracted tree. Publish its verified
        // inodes directly, then independently admit the installed path.
        progress('durable-publication');
        await publishRuntimeTree(payload, installation.releasePath(build.artifact));
        progress('installed-verification');
        if (!(await present())) throw Error('Installed runtime differs from catalog receipt');
      });
      installed = true;
    } finally { await resetInbox(); }
  }
  if (confirmSelection() !== revision) throw Error('Runtime selection changed during staging');
  console.log(JSON.stringify({ installed, artifact: build.artifact, ...(phase !== 'install' && { revision }) }));
} finally { await installation.close(); }
