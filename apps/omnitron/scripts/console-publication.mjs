/** Publish assets before HTML, keeping the mounted directory and older tabs alive. */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const absent = error => error?.code === 'ENOENT';
const safe = name => name.split('/').every(part => /^[a-zA-Z0-9_@+-][a-zA-Z0-9._@+-]*$/.test(part));
function exists(file) { try { fs.lstatSync(file); return true; } catch (error) { if (absent(error)) return false; throw error; } }
function directory(file) {
  if (!exists(file)) fs.mkdirSync(file, { recursive: true });
  if (!fs.lstatSync(file).isDirectory()) throw new Error(`Not a real directory: ${file}`);
}
function read(file) {
  if (!fs.lstatSync(file).isFile()) throw new Error(`Not a regular file: ${file}`);
  return fs.readFileSync(file);
}
function inventory(root) {
  if (!exists(root)) return {};
  const result = {};
  const visit = (dir, prefix = '') => {
    if (!fs.lstatSync(dir).isDirectory()) throw new Error(`Not a real directory: ${dir}`);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (!safe(name)) throw new Error(`Unsafe Console asset name: ${name}`);
      if (entry.isDirectory()) visit(path.join(dir, entry.name), name + '/');
      else result[name] = hash(read(path.join(root, name)));
    }
  };
  visit(root);
  return result;
}
function syncDirectory(dir) {
  const fd = fs.openSync(dir, 'r');
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function atomic(file, bytes) {
  directory(path.dirname(file));
  const temporary = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(temporary, 'wx', 0o644);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  try { fs.renameSync(temporary, file); syncDirectory(path.dirname(file)); }
  finally { if (exists(temporary)) fs.unlinkSync(temporary); }
}

/** Stamp a finished build, independent of timestamps or a Git checkout. */
export function stampConsole(directoryPath) {
  const file = path.join(directoryPath, 'index.html');
  const html = read(file).toString().replace(/<meta name="omnitron-console-build" content="[a-f0-9]+">\n?/, '');
  const version = hash(html);
  if (!html.includes('</head>')) throw new Error('Console build has no HTML head');
  atomic(file, html.replace('</head>', `<meta name="omnitron-console-build" content="${version}">\n</head>`));
  atomic(path.join(directoryPath, 'console-version.json'), JSON.stringify({ version }) + '\n');
  return version;
}

/**
 * Local publication fence. Stale locks are deliberately not stolen: a PID alone
 * cannot prove the previous writer has stopped. A killed publisher leaves the
 * old index usable and requires the operator to inspect its lock before retrying.
 */
export function publishConsole(source, destination, { now = Date.now(), keep = 3, graceMs = 7 * 86400_000 } = {}) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (source === destination) throw new Error('Build into a separate directory before publishing');
  if (!Number.isInteger(keep) || keep < 2 || !Number.isFinite(graceMs) || graceMs < 0) throw new Error('Invalid Console retention policy');
  const files = inventory(source);
  const html = read(path.join(source, 'index.html'));
  const version = JSON.parse(read(path.join(source, 'console-version.json'))).version;
  if (typeof version !== 'string' || !/^[a-f0-9]{64}$/.test(version) || !html.includes(`content="${version}"`))
    throw new Error('Console build identity is missing or invalid');
  const ownAssets = Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('assets/')));
  const scripts = [...html.toString().matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1].slice(1));
  if (!scripts.length || scripts.some(name => !Object.hasOwn(ownAssets, name))) throw new Error('Console HTML references missing assets');
  directory(path.dirname(destination));
  const lock = destination + '.publish-lock';
  try { fs.mkdirSync(lock, { mode: 0o700 }); }
  catch (error) { throw new Error(`Console publication is locked: ${lock}`, { cause: error }); }
  fs.writeFileSync(path.join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, source, at: now }), { mode: 0o600 });
  try {
    directory(destination);
    const ledger = destination + '.publications.json';
    let generations = [];
    if (exists(ledger)) {
      const record = JSON.parse(read(ledger));
      if (record.schema !== 1 || !Array.isArray(record.generations)) throw new Error('Invalid Console publication ledger');
      generations = record.generations;
      for (const gen of generations) {
        if (typeof gen.version !== 'string' || !Number.isFinite(gen.at) || !gen.assets || typeof gen.assets !== 'object' ||
            Object.entries(gen.assets).some(([name, digest]) => !safe(name) || !name.startsWith('assets/') || !/^[a-f0-9]{64}$/.test(digest)))
          throw new Error('Invalid Console publication generation');
      }
    } else if (exists(path.join(destination, 'index.html'))) {
      const assets = inventory(path.join(destination, 'assets'));
      generations = [{ version: 'legacy', at: now, assets: Object.fromEntries(Object.entries(assets).map(([n, digest]) => ['assets/' + n, digest])) }];
    }
    // Verify collisions before changing anything that an existing tab reads.
    for (const [name, digest] of Object.entries(ownAssets)) {
      const file = path.join(destination, name);
      if (exists(file) && hash(read(file)) !== digest) throw new Error(`Immutable Console URL changed: ${name}`);
    }
    for (const [name, digest] of Object.entries(files)) {
      if (['index.html', 'console-version.json', 'BUILD.json'].includes(name)) continue;
      const bytes = read(path.join(source, name));
      if (hash(bytes) !== digest) throw new Error(`Console build changed during publication: ${name}`);
      const target = path.join(destination, name);
      if (!exists(target) || !name.startsWith('assets/')) atomic(target, bytes);
    }
    const all = [{ version, at: now, assets: ownAssets }, ...generations.filter(gen => gen.version !== version)];
    // Durable ownership comes first: a crash before HTML leaves extra assets,
    // never an index whose chunks were not admitted.
    atomic(ledger, JSON.stringify({ schema: 1, generations: all }) + '\n');
    atomic(path.join(destination, 'index.html'), html);
    atomic(path.join(destination, 'console-version.json'), JSON.stringify({ version }) + '\n');
    if (files['BUILD.json']) atomic(path.join(destination, 'BUILD.json'), read(path.join(source, 'BUILD.json')));
    const retained = all.filter((gen, index) => index < keep || now - gen.at < graceMs);
    const held = new Set(retained.flatMap(gen => Object.keys(gen.assets)));
    let pruned = 0;
    for (const gen of all) for (const [name, digest] of Object.entries(gen.assets)) {
      if (held.has(name)) continue;
      const file = path.join(destination, name);
      // Never remove unowned or externally changed bytes.
      if (exists(file) && hash(read(file)) === digest) { fs.unlinkSync(file); pruned++; }
    }
    atomic(ledger, JSON.stringify({ schema: 1, generations: retained }) + '\n');
    return { version, generations: retained.length, assets: held.size, pruned };
  } finally { fs.rmSync(lock, { recursive: true }); }
}
