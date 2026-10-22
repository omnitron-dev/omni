import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { resolve, dirname } from 'node:path';
import { createContext, SourceTextModule } from 'node:vm';

const entry = resolve(process.argv[2]);
const platformNames = ['isWindows', 'linux', 'freebsd', 'openbsd', 'darwin', 'sunos', 'aix'];
const environments = [
  ['absent', {}],
  ['undefined', { process: undefined }],
  ['null', { process: null }],
  ['browser-shim', { process: { env: { NODE_ENV: 'production' } } }],
  ['invalid-platform', { process: { platform: 42 } }],
  ...['win32', 'linux', 'freebsd', 'openbsd', 'darwin', 'sunos', 'aix'].map((platform) => [
    platform,
    { process: { platform } },
  ]),
];
const output = {};
for (const [name, globals] of environments) {
  const context = createContext({ ...globals, setTimeout, clearTimeout, queueMicrotask });
  const modules = new Map();
  async function load(path) {
    if (modules.has(path)) return modules.get(path);
    const source = await readFile(path, 'utf8');
    const code = path.endsWith('.ts') ? stripTypeScriptTypes(source, { mode: 'strip', sourceUrl: path }) : source;
    const module = new SourceTextModule(code, { context, identifier: path });
    modules.set(path, module);
    return module;
  }
  const module = await load(entry);
  await module.link(async (specifier, importer) => {
    if (!specifier.startsWith('./')) throw new Error(`Unexpected runtime import: ${specifier}`);
    const file = entry.endsWith('.ts') ? specifier.replace(/\.js$/, '.ts') : specifier;
    return load(resolve(dirname(importer.identifier), file));
  });
  await module.evaluate();
  const api = module.namespace;
  output[name] = {
    flags: Object.fromEntries(platformNames.map((flag) => [flag, api[flag]])),
    isNodejs: api.isNodejs,
    limitedResult: await api.pLimit(2)(async () => 'completed'),
    decimalSum: api.addDecimals('0.1', '0.2'),
    buffer: api.isBuffer({}),
  };
  // No process, Buffer, or Node global is supplied to the browser/worker frame.
  // The full entry and all its dependencies were evaluated inside that frame.
  const probe = new SourceTextModule('export const values = [typeof process, typeof Buffer, typeof global];', {
    context,
  });
  await probe.link(() => {
    throw new Error('Probe has no imports');
  });
  await probe.evaluate();
  output[name].sourceGlobals = Array.from(probe.namespace.values);
}
console.log(JSON.stringify(output));
