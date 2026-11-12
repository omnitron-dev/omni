import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
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
const rootApi = await imported('@omnitron-dev/lumen-ast');
const { parseDocumentSync, toHtmlSsr, renderKaTeX, parseTwoslashAnnotations } = rootApi;
const diagrams = await imported('@omnitron-dev/lumen-ast/diagrams');
assert.equal(rootApi.renderDiagramSvg, diagrams.renderDiagramSvg, 'public entries must share the same renderer queue');
assert.equal(rootApi.DIAGRAM_LIMITS, diagrams.DIAGRAM_LIMITS, 'public entries must not duplicate shared modules');
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

const execution = await imported('@omnitron-dev/lumen-ast/execution');
const limits = await imported('@omnitron-dev/lumen-ast/execution/limits');
assert.equal(execution.PLAYGROUND_LIMITS, limits.PLAYGROUND_LIMITS);
const { evaluatePlayground } = execution;
assert.equal(await evaluatePlayground('return await Promise.resolve(6 * 7)'), 42);
assert.equal(await evaluatePlayground('return typeof process + ":" + typeof fetch'), 'undefined:undefined');

// Node-only entries must fail actual browser resolution, even though their files exist.
const lumenRequire = createRequire(require.resolve('@omnitron-dev/lumen'));
const { build } = await import(pathToFileURL(lumenRequire.resolve('vite')).href);
const temporary = await mkdtemp(path.join(consumer, '.node-only-exports-'));
try {
  // Compile a real installed consumer, resolving each declared public subpath.
  // No workspace source aliases or declaration fragments may satisfy imports.
  const astEntry = realpathSync(require.resolve('@omnitron-dev/lumen-ast'));
  const astRoot = path.dirname(path.dirname(astEntry));
  const manifest = JSON.parse(readFileSync(path.join(astRoot, 'package.json'), 'utf8'));
  const compilerEntry = realpathSync(createRequire(astEntry).resolve('typescript'));
  assert.ok(compilerEntry.startsWith(path.join(consumer, 'node_modules') + path.sep));
  const { default: ts } = await import(pathToFileURL(compilerEntry).href);
  assert.equal(ts.version, manifest.dependencies.typescript);
  const typeEntry = path.join(temporary, 'consumer.mts');
  await writeFile(typeEntry, `
import { parseDocumentSync, type LumenFrontmatter } from '@omnitron-dev/lumen-ast';
import { evaluatePlayground } from '@omnitron-dev/lumen-ast/execution';
import { PLAYGROUND_LIMITS } from '@omnitron-dev/lumen-ast/execution/limits';
import { serializeIslandProps, type HydrationTrigger } from '@omnitron-dev/lumen-ast/islands';
import { compileTypst } from '@omnitron-dev/lumen-ast/typst';
import { createLumenMcpServer, type LumenMcpCorpus } from '@omnitron-dev/lumen-ast/mcp';
import { renderDiagramHtml } from '@omnitron-dev/lumen-ast/diagrams';
const frontmatter: LumenFrontmatter = { status: 'draft' };
const trigger: HydrationTrigger = 'visible';
const corpus: LumenMcpCorpus = { resourcePaths: [], async search() { return []; }, async getDocument() { return null; } };
void [frontmatter, trigger, serializeIslandProps({ ready: true }),
  evaluatePlayground('return 42', PLAYGROUND_LIMITS.timeoutMs),
  compileTypst(parseDocumentSync('# Typed consumer')), renderDiagramHtml('graph TD; A-->B'),
  createLumenMcpServer(corpus, { name: 'type-consumer', version: '1.0.0' })];
// @ts-expect-error the parser requires source text
parseDocumentSync(42);
// @ts-expect-error frontmatter status cannot be numeric
const invalid: LumenFrontmatter = { status: 42 };
// @ts-expect-error the typesetter requires the actual AST
compileTypst('not an AST');
`);
  const options = { noEmit: true, strict: true, skipLibCheck: true, types: [],
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext };
  for (const [subpath, conditions] of Object.entries(manifest.exports)) {
    const specifier = manifest.name + (subpath === '.' ? '' : subpath.slice(1));
    const resolved = ts.resolveModuleName(specifier, typeEntry, options, ts.sys, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
    assert.ok(resolved, `unresolved public declarations: ${specifier}`);
    assert.equal(realpathSync(resolved.resolvedFileName), realpathSync(path.join(astRoot, conditions.types)));
  }
  for (const relative of readdirSync(path.join(astRoot, 'dist'), { recursive: true }).filter(file => file.endsWith('.d.ts'))) {
    const declaration = path.join(astRoot, 'dist', relative);
    for (const reference of ts.preProcessFile(readFileSync(declaration, 'utf8')).importedFiles) {
      if (!reference.fileName.startsWith('.')) continue;
      const resolved = ts.resolveModuleName(reference.fileName, declaration, options, ts.sys,
        undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
      assert.ok(resolved, `${relative} has a missing declaration import: ${reference.fileName}`);
      assert.ok(realpathSync(resolved.resolvedFileName).startsWith(path.join(astRoot, 'dist') + path.sep));
    }
  }
  const program = ts.createProgram([typeEntry], options);
  assert.deepEqual(ts.getPreEmitDiagnostics(program).map(diagnostic =>
    ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')), [], 'installed public declarations must typecheck');

  for (const subpath of ['typst', 'mcp']) {
    const entry = path.join(temporary, 'entry.js');
    await writeFile(entry, `import * as api from '@omnitron-dev/lumen-ast/${subpath}'; console.log(api);`);
    await assert.rejects(build({ root: consumer, configFile: false, logLevel: 'silent', publicDir: false,
      build: { write: false, rolldownOptions: { input: entry } },
    }), /No known conditions|not exported|Missing.*specifier|package entry|not defined by.*exports/i);
  }
} finally { await rm(temporary, { recursive: true, force: true }); }
console.log(JSON.stringify({ check: 'lumen-consumer-runtime', passed: true, pdfPages: 1, wasmResult: 42 }));
