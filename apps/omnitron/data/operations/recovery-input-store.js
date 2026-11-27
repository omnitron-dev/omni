/** Verify and stage an admitted release without extracting application code on the host. */
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { link, mkdir, open, readFile, statfs } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { isDeepStrictEqual } from 'node:util';
import { createGunzip } from 'node:zlib';
import { list } from 'tar';
import { check, parseStrict } from './recovery-observations.js';

const GiB = 1024 ** 3;
const MiB = 1024 ** 2;
const sha = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const readonly = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const directoryFlags = readonly | constants.O_DIRECTORY;

function relativeFile(name) {
  check(typeof name === 'string' && name.length <= 1024 && !/[\\\p{C}\p{Z}]/u.test(name.replaceAll(' ', '')) &&
    name.split('/').every(part => part && part !== '.' && part !== '..'), 'Invalid relative path');
  return name;
}

/** The sole trusted path base after this call is the open directory descriptor. */
async function openInputDirectory(home) {
  let directory = await open(home, directoryFlags);
  try {
    for (const name of ['.omnitron', 'recovery-inputs']) {
      const next = await open('/proc/self/fd/' + directory.fd + '/' + name, directoryFlags);
      try { await directory.close(); } catch (error) { await next.close(); throw error; }
      directory = next;
    }
    return directory;
  } catch (error) { await directory.close(); throw error; }
}

export async function verifyPrograms(archive, artifact, runtime, signal) {
  const source = artifact.packageSource;
  check(source?.migrations && typeof source.migrations === 'object' && !Array.isArray(source.migrations), 'Invalid release migration inventory');
  const programs = source.migrationPrograms ?? [];
  check(Array.isArray(programs) && programs.length <= 64 && (!Object.keys(source.migrations).length || programs.length),
    'Missing declared migration program');
  const expected = new Map(), parents = new Set();
  const include = (name, hash) => {
    relativeFile(name);
    check(!expected.has(name) && sha(hash), 'Duplicate or invalid compiled migration entry');
    expected.set(name, hash);
    for (let parent = path.posix.dirname(name); parent !== '.'; parent = path.posix.dirname(parent)) parents.add(parent);
  };
  for (const program of programs) include(program.release, program.releaseSha256);
  const closure = '.omnitron-closure.json';
  include(closure, artifact.closureSha256 ?? artifact.launch?.closureSha256);
  let count = 0, size = 0, tarBytes = 0;
  const found = new Set();
  // Bound headers, padding and extensions as well as the sum of member sizes.
  const expanded = new Transform({ transform(chunk, _, next) {
    tarBytes += chunk.length;
    next(tarBytes > 5 * GiB + 256 * MiB ? Error('Expanded release exceeds limits') : null, chunk);
  } });
  const tar = list({ strict: true, brotli: false, zstd: false, maxDecompressionRatio: 0, maxMetaEntrySize: MiB, onReadEntry(entry) {
    try {
      check(++count <= 160_000 && Number.isSafeInteger(entry.size) && entry.size >= 0 &&
        (size += entry.size) <= 5 * GiB, 'Expanded release exceeds limits');
      const relative = entry.path.replace(/^\.\//, '');
      const name = entry.type === 'Directory' ? relative.replace(/\/$/, '') : relative;
      if (!name || name === '.') { check(entry.type === 'Directory', 'Invalid archive root'); return; }
      relativeFile(name);
      if (parents.has(name)) check(entry.type === 'Directory', 'Non-directory on compiled migration path');
      if (!expected.has(name)) return;
      check(!found.has(name) && ['File', 'OldFile', 'ContiguousFile'].includes(entry.type) &&
        entry.size > 0 && entry.size <= 16 * MiB, 'Unsafe or duplicate compiled entry');
      found.add(name);
      const hash = createHash('sha256'), chunks = [];
      entry.on('data', chunk => { hash.update(chunk); if (name === closure) chunks.push(chunk); });
      entry.on('end', () => {
        try {
          check(hash.digest('hex') === expected.get(name), 'Compiled entry differs from its release: ' + name);
          if (name === closure) {
            const data = parseStrict(Buffer.concat(chunks));
            check(data.protocol === 1 && isDeepStrictEqual(data.runtime, runtime), 'Archive closure targets a different runtime');
          }
        } catch (error) { tar.abort(error); }
      });
    } catch (error) { tar.abort(error); }
  } });
  tar.on('ignoredEntry', () => tar.abort(Error('Unsupported or oversized release entry')));
  await pipeline(createReadStream(archive), createGunzip(), expanded, tar, { signal });
  check(found.size === expected.size, 'Missing compiled migration or application closure');
}

export async function stageInputs(home, scratch, spec, signal) {
  const directory = await openInputDirectory(home);
  const cached = new Map();
  let total = 0;
  async function copy(hash, max) {
    check(sha(hash), 'Invalid staged blob identity');
    if (cached.has(hash)) {
      const known = cached.get(hash);
      check(known.size <= max, 'Input exceeds its role limit');
      return known;
    }
    signal.throwIfAborted();
    const source = await open('/proc/self/fd/' + directory.fd + '/' + hash, readonly);
    try {
      const info = await source.stat();
      check(info.isFile() && info.size <= max && total + info.size <= 8 * GiB, 'Unsafe or oversized staged blob');
      const fs = await statfs(scratch, { bigint: true });
      check(fs.bavail * fs.bsize >= BigInt(info.size + GiB), 'Insufficient scratch space on QA node');
      const file = path.join(scratch, hash), sum = createHash('sha256');
      let size = 0;
      const out = await open(file, 'wx', 0o600);
      try {
        for await (const chunk of source.createReadStream({ autoClose: false, signal })) {
          size += chunk.length;
          check(size <= info.size, 'Staged input grew');
          sum.update(chunk);
          await out.writeFile(chunk);
        }
        check(size === info.size && sum.digest('hex') === hash, 'Staged blob differs from the admitted bytes');
        await out.chmod(0o444);
      } finally { await out.close(); }
      total += size;
      const checked = { file, size };
      cached.set(hash, checked);
      return checked;
    } finally { await source.close(); }
  }

  async function release(role) {
    const item = spec[role], root = path.join(scratch, role);
    await mkdir(root, { mode: 0o755 });
    const manifest = await copy(item.manifestSha256, 16 * MiB);
    const data = parseStrict(await readFile(manifest.file));
    check(data.id === item.id && data.project.commit === item.commit && Array.isArray(data.artifacts) &&
      data.artifacts.length === Object.keys(item.artifacts).length &&
      isDeepStrictEqual(Object.fromEntries(data.artifacts.map(a => [a.app, a.sha256])), item.artifacts),
    'Release archive membership differs');
    await link(manifest.file, path.join(root, 'manifest.json'));
    await mkdir(path.join(root, 'artifacts'), { mode: 0o755 });
    for (const artifact of data.artifacts) {
      check(typeof artifact.app === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(artifact.app), 'Invalid application name');
      const archive = await copy(artifact.sha256, GiB);
      check(archive.size === artifact.bytes, 'Archive size differs from manifest');
      await verifyPrograms(archive.file, artifact, data.builtWith.target, signal);
      await link(archive.file, path.join(root, 'artifacts', artifact.app + '.tgz'));
    }
    check(Boolean(data.statics) === Boolean(item.staticsIndexSha256), 'Static release index is missing or unexpected');
    if (item.staticsIndexSha256) {
      const index = parseStrict(await readFile((await copy(item.staticsIndexSha256, 4 * MiB)).file));
      check(index && typeof index === 'object' && !Array.isArray(index), 'Invalid static index');
      const entries = Object.entries(index);
      check(entries.length > 0 && entries.length <= 32768 && entries.length === data.statics.files, 'Static index coverage differs');
      const staticRoot = path.join(root, 'statics');
      await mkdir(staticRoot, { mode: 0o755 });
      let size = 0;
      for (const [name, record] of entries) {
        const target = path.join(staticRoot, relativeFile(name));
        check(record && isDeepStrictEqual(Object.keys(record).sort(), ['bytes', 'sha256']), 'Unexpected static index entry');
        const member = await copy(record.sha256, 128 * MiB);
        check(member.size === record.bytes, 'Incorrect static member size');
        size += member.size;
        await mkdir(path.dirname(target), { mode: 0o755, recursive: true });
        await link(member.file, target);
      }
      check(size === data.statics.bytes, 'Static bytes differ from manifest');
    }
    return { root, manifest: data };
  }

  try {
    const roles = {};
    for (const role of ['incumbent', 'candidate', 'recovery']) roles[role] = await release(role);
    const before = roles.incumbent.manifest.migrations, after = roles.candidate.manifest.migrations;
    check(before && after && !Array.isArray(before) && !Array.isArray(after) &&
      isDeepStrictEqual(after, roles.recovery.manifest.migrations) &&
      Object.entries(before).every(([k,v]) => Object.hasOwn(after,k) && after[k] === v) &&
      isDeepStrictEqual(Object.keys(after).filter(k => !Object.hasOwn(before,k)).sort(), [...spec.addedMigrations].sort()),
    'Staged migration inventories differ');
    return { roles, probe: (await copy(spec.probe.sha256, 256 * 1024)).file };
  } finally { await directory.close(); }
}
