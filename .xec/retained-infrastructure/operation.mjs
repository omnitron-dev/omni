import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { verifiedInputs } from './review.mjs';
import { readStoppedAllocation, sealOriginal, stageStopped } from './stage.mjs';

const checksum = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = message => { throw Error(message); };
const digest = /^[a-f0-9]{64}$/;

function privateDirectory(dir) {
  if (!path.isAbsolute(dir) || fs.realpathSync(dir) !== dir) fail('Select a private, fixed source recovery directory');
  const st = fs.lstatSync(dir);
  if (!st.isDirectory() || st.uid !== process.getuid() || st.mode & 0o077) fail('The recovery directory must belong to the operator and have mode 0700');
}

function fileBytes(file, limit, privateFile = false) {
  if (!path.isAbsolute(file) || fs.realpathSync(file) !== file) fail('Select an existing regular file by its canonical path');
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.size < 1 || st.size > limit || st.nlink !== 1 || st.uid !== process.getuid() ||
        st.mode & (privateFile ? 0o077 : 0o022)) fail('The source artifact has unexpected ownership, size or permissions');
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function reserveSourceSeal(ownerHome, source, operation, accepted) {
  const parent = path.join(ownerHome, 'infrastructure-return');
  try { fs.mkdirSync(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  privateDirectory(parent);
  const selected = path.join(parent, [source.project, source.stack, operation].join('.') + '.json');
  const payload = Buffer.from(JSON.stringify({ protocol: 1, project: source.project, stack: source.stack, operation, seal: accepted }));
  const temporary = path.join(parent, randomUUID() + '.tmp');
  const fd = fs.openSync(temporary, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY, 0o600);
  try { fs.writeFileSync(fd, payload); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try {
    try { fs.linkSync(temporary, selected); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  } finally { fs.unlinkSync(temporary); }
  if (!fileBytes(selected, 4096, true).equals(payload)) fail('Another source seal owns this native stop operation');
  const dir = fs.openSync(parent, fs.constants.O_DIRECTORY | fs.constants.O_RDONLY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function supplementalFiles(declaration, supplied) {
  const policy = declaration.supplement;
  if (!policy && !supplied) return undefined;
  if (!policy || !supplied || !digest.test(policy.sha256) || !Number.isSafeInteger(policy.bytes) || policy.bytes <= 0)
    fail('This release requires its separately accepted public supplement');
  const bytes = fileBytes(supplied, 64 * 1024 * 1024);
  if (bytes.length !== policy.bytes || checksum(bytes) !== policy.sha256) fail('The public supplement differs from the qualified archive');
  const tar = gunzipSync(bytes, { maxOutputLength: 256 * 1024 * 1024 });
  return { ...policy, install(object) {
    const cp = spawnSync('docker', ['container', 'cp', '-', object + ':/'], {
      input: tar, stdio: ['pipe', 'ignore', 'ignore'], timeout: 120000 });
    if (cp.status !== 0 || cp.error) fail('The reviewed public supplemental files were not installed');
  } };
}

export async function runSourceOperation(mode, options) {
  if (!['seal', 'create-stopped'].includes(mode)) fail('Unknown retained source operation');
  privateDirectory(options.directory);
  const { subject, authorities } = await verifiedInputs(options);
  const releases = path.dirname(options.runtimeRoot), runtime = path.dirname(releases);
  if (path.basename(releases) !== 'releases' || path.basename(runtime) !== 'runtime') fail('A source operation requires its installed owner runtime');
  const ownerHome = path.dirname(runtime);
  const owner = fs.lstatSync(ownerHome);
  if (!owner.isDirectory() || owner.uid !== process.getuid() || owner.mode & 0o022) fail('The registered source owner has unsafe ownership');
  const stateDb = path.join(ownerHome, 'data', 'daemon-state.db');
  // Verify the exact public binary supplement before either capturing or allocating.
  const supplement = supplementalFiles(subject, options.publicSupplement);
  if (mode === 'seal') {
    const sealed = sealOriginal(subject, { ...authorities, volumeRoot: options.volumeRoot });
    const bytes = Buffer.from(JSON.stringify(sealed) + '\n');
    const sha = checksum(bytes), target = path.join(options.directory, sha + '.json');
    const fd = fs.openSync(target, fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_WRONLY | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    const dir = fs.openSync(options.directory, fs.constants.O_DIRECTORY | fs.constants.O_RDONLY);
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    return { protocol: 1, project: subject.project, stack: subject.stack, release: subject.release, sealSha256: sha,
      services: subject.services.length, namedVolumes: Object.keys(sealed.physical.volumes).length,
      ...(supplement && { publicSupplementSha256: supplement.sha256 }) };
  }
  if (!digest.test(options.seal ?? '')) fail('Select the independently accepted source-local seal');
  const bytes = fileBytes(path.join(options.directory, options.seal + '.json'), 4 * 1024 * 1024, true);
  if (checksum(bytes) !== options.seal) fail('The source-local seal changed');
  const sealed = JSON.parse(bytes);
  return stageStopped(subject, sealed, { fingerprint: authorities.fingerprint, bindings: authorities.bindings,
    confirmedStop: () => readStoppedAllocation(stateDb, subject, options.nodeStop),
    reserve: () => reserveSourceSeal(ownerHome, subject, options.nodeStop, options.seal),
    supplement });
}
