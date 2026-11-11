import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// Resolve only from the npm consumer, with no workspace links or overrides.
const require = createRequire(path.join(path.resolve(process.argv[2]), 'package.json'));
const { parseDocumentSync, toHtmlSsr, renderKaTeX } = await import(
  pathToFileURL(require.resolve('@omnitron-dev/lumen-ast')).href
);
const ast = parseDocumentSync('# Math\n\nInline $x^2$ and display:\n\n$$\nx + y\n$$\n');
assert.deepEqual(ast.diagnostics, []);
assert.equal(ast.children[1].children[1].type, 'mathInline');
assert.equal(ast.children[2].type, 'mathBlock');
const html = toHtmlSsr(ast);
assert.match(html, /class="katex"/);
assert.match(html, /katex-display/);
const untrusted = renderKaTeX('\\href{javascript:alert(1)}{unsafe}');
assert.doesNotMatch(untrusted.html, /href="javascript:/);
console.log(JSON.stringify({ check: 'lumen-consumer-math', passed: true }));
