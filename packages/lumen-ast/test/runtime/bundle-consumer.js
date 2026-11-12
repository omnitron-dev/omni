import assert from 'node:assert/strict';
import { realpathSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

// Resolve only from the npm consumer, with no workspace links or overrides.
const consumer = realpathSync(process.argv[2]);
const require = createRequire(path.join(consumer, 'package.json'));
async function imported(specifier) {
  const entry = realpathSync(require.resolve(specifier));
  assert.ok(entry.startsWith(path.join(consumer, 'node_modules') + path.sep), `${specifier} escaped the archive consumer`);
  return import(pathToFileURL(entry).href);
}
const { parseDocumentSync, toHtmlSsr, renderKaTeX, parseTwoslashAnnotations } = await imported('@omnitron-dev/lumen-ast');
const types = parseTwoslashAnnotations('const value = [1, 2].at(-1);\n//    ^?');
assert.deepEqual(types.actualErrors, []);
assert.equal(types.errorsValid, true);
assert.match(types.annotations[0].text, /number \| undefined/);
const ast = parseDocumentSync('# Math\n\nInline $x^2$ and display:\n\n$$\nx + y\n$$\n');
assert.deepEqual(ast.diagnostics, []);
assert.equal(ast.children[1].children[1].type, 'mathInline');
assert.equal(ast.children[2].type, 'mathBlock');
const html = toHtmlSsr(ast);
assert.match(html, /class="katex"/);
assert.match(html, /katex-display/);
const untrusted = renderKaTeX('\\href{javascript:alert(1)}{unsafe}');
assert.doesNotMatch(untrusted.html, /href="javascript:/);

// Both the WASM typesetter and all of its fonts must be reachable from the archive.
// PDF.js is a test oracle, never part of the consumer's runtime dependency graph.
const { compileTypst } = await imported('@omnitron-dev/lumen-ast/typst');
const pdf = await compileTypst(parseDocumentSync('# Проверка архива\n\nRendered archive mathematics: $x^2 + y^2$.\n'));
const loading = getDocument({ data: pdf, useSystemFonts: false, isEvalSupported: false });
try {
  const document = await loading.promise;
  assert.equal(document.numPages, 1);
  const page = await document.getPage(1);
  const content = await page.getTextContent();
  const text = content.items.filter(item => 'str' in item).map(item => item.str).join(' ');
  assert.match(text, /Проверка архива/);
  assert.match(text, /Rendered archive mathematics/);
  assert.ok(Math.abs(page.view[2] - page.view[0] - 595.28) < 1);
  assert.ok(Math.abs(page.view[3] - page.view[1] - 841.89) < 1);
} finally { await loading.destroy(); }

const { evaluatePlayground } = await imported('@omnitron-dev/lumen-ast/execution');
assert.equal(await evaluatePlayground('return await Promise.resolve(6 * 7)'), 42);
assert.equal(await evaluatePlayground('return typeof process + ":" + typeof fetch'), 'undefined:undefined');

// Node-only entries must fail actual browser resolution, even though their files exist.
const lumenRequire = createRequire(require.resolve('@omnitron-dev/lumen'));
const { build } = await import(pathToFileURL(lumenRequire.resolve('vite')).href);
const temporary = await mkdtemp(path.join(consumer, '.node-only-exports-'));
try {
  for (const subpath of ['typst', 'mcp']) {
    const entry = path.join(temporary, 'entry.js');
    await writeFile(entry, `import * as api from '@omnitron-dev/lumen-ast/${subpath}'; console.log(api);`);
    await assert.rejects(build({ root: consumer, configFile: false, logLevel: 'silent', publicDir: false,
      build: { write: false, rolldownOptions: { input: entry } },
    }), /No known conditions|not exported|Missing.*specifier|package entry|not defined by.*exports/i);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log(JSON.stringify({ check: 'lumen-consumer-runtime', passed: true, pdfPages: 1, wasmResult: 42 }));
