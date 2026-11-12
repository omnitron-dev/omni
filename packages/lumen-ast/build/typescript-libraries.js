import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const sourceModule = fileURLToPath(new URL('../src/highlight/typescript-libraries.js', import.meta.url));
const id = '\0' + sourceModule;
let source;

/** Embed the declared compiler's real library closure, never an imitation lib.d.ts. */
export function typescriptLibrariesSource() {
  if (source) return source;
  const library = ts.getDefaultLibFilePath({ target: ts.ScriptTarget.ES2022 });
  const directory = dirname(library);
  const files = {};
  let bytes = 0;
  const load = (name) => {
    if (!/^lib(?:\.[a-z0-9-]+)*\.d\.ts$/.test(name)) throw new Error('Invalid TypeScript library reference: ' + name);
    const key = '/' + name;
    if (Object.hasOwn(files, key)) return;
    const contents = readFileSync(join(directory, name), 'utf8');
    bytes += Buffer.byteLength(contents);
    if (Object.keys(files).length >= 256 || bytes > 16 * 1024 * 1024)
      throw new Error('TypeScript library closure exceeds its build budget');
    files[key] = contents;
    const references = ts.preProcessFile(contents, true);
    for (const reference of references.libReferenceDirectives) load('lib.' + reference.fileName + '.d.ts');
    for (const reference of references.referencedFiles) load(reference.fileName);
  };
  const defaultLibrary = '/' + basename(library);
  load(defaultLibrary.slice(1));
  source = 'export default ' + JSON.stringify({ version: ts.version, defaultLibrary, files }) + ';\n';
  return source;
}

export function typescriptLibrariesVitePlugin() {
  return {
    name: 'lumen-typescript-libraries',
    resolveId(request, importer) {
      return importer && request === './typescript-libraries.js' &&
        resolve(dirname(importer.split('?')[0]), request) === sourceModule ? id : null;
    },
    load(request) {
      return request === id ? typescriptLibrariesSource() : null;
    },
  };
}

// The package build emits ordinary ESM. Only this generated asset needs a
// separate write; source tests resolve the same generator through Vite above.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const target = resolve('dist/highlight/typescript-libraries.js');
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, typescriptLibrariesSource());
}
