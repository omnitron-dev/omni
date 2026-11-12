/** Offline snapshot of an already-built backend. No install scripts or npm writes. */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertStandaloneNodeConfiguration, copyStandaloneNode } from './standalone-node.js';

const [sourceInput, outputInput, ...overlayInputs] = process.argv.slice(2);
if (!sourceInput || !outputInput) throw Error('Usage: node freeze-backend.mjs <built-package> <new-directory> [package=compiled-package-directory ...]');
const source = fs.realpathSync(sourceInput), output = path.resolve(outputInput);
if (fs.existsSync(output)) throw Error('Runtime destination already exists; never overwrite a release');
assertStandaloneNodeConfiguration(process.config.variables);
const consoleSources = path.join(source, 'webapp/package.json');
const isConsoleWorkspace = fs.existsSync(consoleSources) && JSON.parse(fs.readFileSync(consoleSources, 'utf8')).name === '@omnitron/console';
if (!isConsoleWorkspace && fs.existsSync(path.join(source, 'webapp/index.html'))) {
  throw Error('Console output is misplaced at webapp/index.html. Publish the prebuilt Console to webapp/dist before freezing; nginx serves only that directory.');
}
if (fs.existsSync(path.join(source, 'webapp')) && !fs.existsSync(path.join(source, 'webapp/dist/index.html'))) {
  throw Error('Console package is incomplete: webapp/dist/index.html is missing. Include the prebuilt Console, or prepare a headless package without the webapp directory.');
}
const { runtimeArtifactDigest, verifyRuntimeArtifact } = await import(pathToFileURL(path.join(source, 'dist/shared/runtime-artifact.js')));
const { installedGraph, materializeGraph } = await import('../dist/release/installed-graph.js');
const overlays = new Map();
for (const input of overlayInputs) {
  const split = input.indexOf('=');
  if (split < 1) throw Error('An overlay must specify package=absolute-directory');
  const name = input.slice(0, split), root = fs.realpathSync(input.slice(split + 1));
  if (JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name !== name) throw Error('Overlay package identity mismatch');
  overlays.set(name, root);
}
overlays.set(JSON.parse(fs.readFileSync(path.join(source, 'package.json'), 'utf8')).name, source);
const packages = await installedGraph(source, overlays);
// Reusing an immutable installed graph is also an offline build. Registry
// packages inside it no longer have a node_modules path, but their files have
// already been selected by packing. Validate the entire containing release
// before treating those directories as unpacked packages; never trust a path
// or an unverified RUNTIME.json alone.
const sealedPackages = new Set(), verifiedReleases = new Set();
for (const item of packages) {
  const parent = path.dirname(item.root), release = path.dirname(parent);
  if (path.basename(parent) !== 'packages' || !/^(0|[1-9][0-9]*)$/.test(path.basename(item.root)) ||
      !fs.existsSync(path.join(release, 'RUNTIME.json'))) continue;
  if (!verifiedReleases.has(release)) {
    await verifyRuntimeArtifact(release);
    verifiedReleases.add(release);
  }
  sealedPackages.add(item.root);
}
fs.mkdirSync(output, { mode: 0o700, recursive: true });
// Admit and exercise the exact interpreter before materializing or sealing the
// package graph. A byte-valid snapshot is not proof that its Node can start.
await copyStandaloneNode(path.join(output, 'node'));
await materializeGraph(packages, packages.map((_, id) => path.join(output, 'packages', String(id))), { verifiedPackages: sealedPackages });
// Some Linux copy implementations retain the source uid when copying as root
// (including official Node archives). Only this new, isolated tree belongs to
// the instance owner; never chown the serving runtime or relax its verifier.
function ownCopy(file) {
  const stat = fs.lstatSync(file);
  if (process.getuid && stat.uid !== process.getuid()) fs.lchownSync(file, process.getuid(), process.getgid());
  if (stat.isDirectory()) for (const name of fs.readdirSync(file)) ownCopy(path.join(file, name));
}
ownCopy(output);
const manifest = { protocol: 1, sha256: await runtimeArtifactDigest(output), platform: process.platform,
  arch: process.arch, nodeVersion: process.version, packages: packages.length };
fs.writeFileSync(path.join(output, 'RUNTIME.json'), JSON.stringify(manifest) + '\n', { flag: 'wx', mode: 0o600 });
await verifyRuntimeArtifact(output);
console.log(JSON.stringify({ directory: output, dist: path.join(output, 'packages/0/dist'), ...manifest }));
