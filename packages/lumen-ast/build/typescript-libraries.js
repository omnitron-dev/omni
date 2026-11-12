import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import ts from 'typescript';

const id = 'virtual:lumen-typescript-libraries';
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
    resolveId(request) {
      return request === id ? '\0' + id : null;
    },
    load(request) {
      return request === '\0' + id ? typescriptLibrariesSource() : null;
    },
  };
}

export function typescriptLibrariesEsbuildPlugin() {
  return {
    name: 'lumen-typescript-libraries',
    setup(build) {
      build.onResolve({ filter: /^virtual:lumen-typescript-libraries$/ }, () => ({ path: id, namespace: id }));
      build.onLoad({ filter: /.*/, namespace: id }, () => ({ contents: typescriptLibrariesSource(), loader: 'js' }));
    },
  };
}
