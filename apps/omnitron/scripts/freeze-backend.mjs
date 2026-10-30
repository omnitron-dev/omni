/** Offline snapshot of an already-built backend. No install scripts or npm writes. */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const [sourceInput, outputInput, ...overlayInputs] = process.argv.slice(2);
if (!sourceInput || !outputInput) throw Error('Usage: node freeze-backend.mjs <built-package> <new-directory> [package=compiled-package-directory ...]');
const source = fs.realpathSync(sourceInput), output = path.resolve(outputInput);
if (fs.existsSync(output)) throw Error('Runtime destination already exists; never overwrite a release');
const { runtimeArtifactDigest, verifyRuntimeArtifact } = await import(pathToFileURL(path.join(source, 'dist/shared/runtime-artifact.js')));
const overlays = new Map();
for (const input of overlayInputs) {
  const split = input.indexOf('=');
  if (split < 1) throw Error('An overlay must specify package=absolute-directory');
  const name = input.slice(0, split), root = fs.realpathSync(input.slice(split + 1));
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== name) throw Error('Overlay package identity mismatch');
  overlays.set(name, root);
}
const sources = new Map(), packages = [];
function locate(name, from) {
  // Names such as process/buffer also name Node builtins. Asking for their
  // package subpath finds the installed polyfill used by dependencies.
  for (const parent of createRequire(path.join(from, 'package.json')).resolve.paths(`${name}/package.json`) ?? []) {
    const candidate = path.join(parent, name);
    if (fs.existsSync(path.join(candidate, 'package.json'))) return fs.realpathSync(candidate);
  }
  return null;
}
function visit(root) {
  root = fs.realpathSync(root);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const overlay = overlays.get(meta.name);
  if (overlay && overlay !== root) {
    const replacement = JSON.parse(fs.readFileSync(path.join(overlay, 'package.json'), 'utf8'));
    if (replacement.version !== meta.version) throw Error(`Overlay changes the installed version of ${meta.name}; align dependencies first`);
    root = overlay;
  }
  if (sources.has(root)) return sources.get(root);
  const id = packages.length;
  const metadata = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  sources.set(root, id);
  const item = { root, metadata, dependencies: {} };
  packages.push(item);
  for (const name of Object.keys({ ...metadata.dependencies, ...metadata.optionalDependencies, ...metadata.peerDependencies }).sort()) {
    const dependency = locate(name, root);
    if (!dependency) {
      if (name in (metadata.optionalDependencies ?? {}) || metadata.peerDependenciesMeta?.[name]?.optional) continue;
      throw Error(`Missing installed dependency: ${metadata.name} -> ${name}`);
    }
    item.dependencies[name] = visit(dependency);
  }
  return id;
}
overlays.set(JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name, source);
visit(source);
fs.mkdirSync(output, { mode: 0o700, recursive: true });
const skip = name => ['node_modules', '.git', '.DS_Store', '.codex', '.agents', '.turbo', '.cache', 'coverage'].includes(name) || name === '.env' || name.startsWith('.env.');
for (const [id, item] of packages.entries()) {
  const destination = path.join(output, 'packages', String(id));
  const copy = (from, to) => fs.cpSync(from, to, { recursive: true, dereference: true,
    filter: file => !skip(path.basename(file)) });
  fs.mkdirSync(destination, { recursive: true });
  // Local workspaces may contain private developer files. Copy their declared
  // publication surface; registry packages already contain their packed files.
  if (!item.root.includes(`${path.sep}node_modules${path.sep}`) && Array.isArray(item.metadata.files)) {
    const entries = new Set(['package.json', 'LICENSE', 'README.md', ...item.metadata.files]);
    for (const relative of entries) {
      if (typeof relative !== 'string' || /[*?{}!]/.test(relative) || path.isAbsolute(relative) || relative.split('/').includes('..')) {
        throw Error(`Unsupported publication pattern in ${item.metadata.name}; prepare an unpacked package first`);
      }
      const file = path.join(item.root, relative);
      if (fs.existsSync(file)) copy(file, path.join(destination, relative));
    }
  } else copy(item.root, destination);
}
for (const [id, item] of packages.entries()) {
  for (const [name, child] of Object.entries(item.dependencies)) {
    const link = path.join(output, 'packages', String(id), 'node_modules', name);
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(path.relative(path.dirname(link), path.join(output, 'packages', String(child))), link);
  }
}
fs.copyFileSync(process.execPath, path.join(output, 'node'));
fs.chmodSync(path.join(output, 'node'), 0o500);
const manifest = { protocol: 1, sha256: await runtimeArtifactDigest(output), platform: process.platform,
  arch: process.arch, nodeVersion: process.version, packages: packages.length };
fs.writeFileSync(path.join(output, 'RUNTIME.json'), JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
await verifyRuntimeArtifact(output);
console.log(JSON.stringify({ directory: output, dist: path.join(output, 'packages/0/dist'), ...manifest }));
