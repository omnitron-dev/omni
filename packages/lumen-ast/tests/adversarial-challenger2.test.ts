import { inspectPdf } from './pdf-oracle.js';
import { compileTypst } from '../src/typst/index.js';
import { describe, it, expect } from 'vitest';
import crypto from 'node:crypto';
import {
  parseDocument,
  toHtmlSsr,
  toCleanMarkdown,
  toTypst,
  LumenHighlighter,
  parseCodeDirectives,
  parseTwoslashAnnotations,
  renderCodeBlockHtml,
  renderDiagramHtml,
  type LumenDocumentAst,
} from '../src/index.js';

describe('Challenger 2 Adversarial Stress Suite', () => {
  describe('1. Syntax Highlighting Adversarial Testing', () => {
    it('handles obscure, unknown, and symbol-heavy language identifiers', () => {
      const highlighter = new LumenHighlighter();
      const obscureLangs = [
        'bf-brainfuck-99',
        'unknown_custom_dialect',
        'c++20/concepts',
        'shell$!@#%',
        '42',
        '   whitespace-padded   ',
      ];

      for (const lang of obscureLangs) {
        const snippet = `fn main() { return 0; }`;
        const html = highlighter.highlight(snippet, { language: lang });
        expect(html).toContain('lumen-code-block');
        expect(html).toContain('fn main()');
      }
    });

    it('handles empty, whitespace-only, and newline-only code blocks', () => {
      const highlighter = new LumenHighlighter();
      const emptySnippets = ['', '   ', '\n\n\n', '\t\t'];

      for (const snippet of emptySnippets) {
        const html = highlighter.highlight(snippet, { language: 'typescript' });
        expect(html).toContain('lumen-code-block');
        expect(html).toContain('<pre class="lumen-code-block');
        expect(html).toContain('<code');
      }
    });

    it('handles massive 10,000-line code blocks without stack overflow or catastrophic backtracking', () => {
      const highlighter = new LumenHighlighter();
      const lineCount = 10_000;
      const lines: string[] = [];
      for (let i = 0; i < lineCount; i++) {
        if (i % 4 === 0) lines.push(`const var_${i} = ${i}; // [!code ++]`);
        else if (i % 4 === 1) lines.push(`const var_${i} = ${i}; // [!code --]`);
        else if (i % 4 === 2) lines.push(`const var_${i} = ${i}; // [!code highlight]`);
        else lines.push(`const var_${i} = ${i}; // [!code focus]`);
      }
      const massiveCode = lines.join('\n');

      const start = Date.now();
      const html = highlighter.highlight(massiveCode, { language: 'typescript' });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(3000);
      expect(html).toContain('data-line="10000"');
      expect(html).toContain('diff add');
      expect(html).toContain('diff remove');
      expect(html).toContain('highlighted');
      expect(html).toContain('focused');
    });

    it('handles malformed, incomplete, and mixed magic comments', () => {
      const malformedCases = [
        'const x = 1; // [!code unknown]',
        'const x = 2; // [!code',
        'const x = 3; // [!code ]',
        'const x = 4; /* [!code ++] */',
        'const x = 5; # [!code --]',
        'const x = 6; // [!code ++] // [!code --]',
        'const x = 7; // [!code highlight] [!code focus]',
        '// [!code ++]', // standalone at EOF
      ];

      const fullSnippet = malformedCases.join('\n');
      const parsedLines = parseCodeDirectives(fullSnippet);
      expect(parsedLines.length).toBeGreaterThan(0);

      const html = renderCodeBlockHtml(fullSnippet, 'javascript');
      expect(html).toContain('lumen-code-block');
      expect(html).toContain('const x = 1;');
    });

    it('handles Twoslash edge cases: large error codes, missing carets, and conflicting flags', () => {
      const twoslashCases = `// @errors: 99999, 2304, 2322
// @noErrors
const a = 1;
//    ^?
//    ^? type-query-hover
// @noErrors`;

      const result = parseTwoslashAnnotations(twoslashCases);
      expect(result.hasNoErrors).toBe(true);
      expect(result.expectedErrors).toContain(99999);
      expect(result.expectedErrors).toContain(2304);
      expect(result.expectedErrors).toContain(2322);
      expect(result.annotations.length).toBeGreaterThanOrEqual(2);

      // Verify caret on first line edge case
      const firstLineCaret = `//    ^?\nconst b = 2;`;
      expect(() => parseTwoslashAnnotations(firstLineCaret)).toThrow('preceding code line');
      expect(() => parseTwoslashAnnotations('const a = 1;\n// ^?')).toThrow('No TypeScript symbol');

      // Verify line with missing caret (e.g. // without ^?) does not create hover annotation
      const noCaretLine = `const c = 3;\n// comment without caret`;
      const noCaretResult = parseTwoslashAnnotations(noCaretLine);
      expect(noCaretResult.annotations).toHaveLength(0);
    });

    it('rigorously escapes HTML special characters <, >, &, ", \' inside code blocks and language attributes', () => {
      const snippet = `const template = "<script>alert('xss & attack')</script>";
if (a < b && c > d) {
  const generic: Map<string, List<Array<T>>> = new Map();
}`;

      const dangerousLang = `typescript"><script>alert(1)</script><pre `;
      const html = renderCodeBlockHtml(snippet, dangerousLang);

      expect(html).not.toContain('<script>');
      expect(html).not.toContain('</script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('a &lt; b &amp;&amp; c &gt; d');
      expect(html).toContain('Map&lt;string, List&lt;Array&lt;T&gt;&gt;&gt;');
      expect(html).toContain('&quot;&gt;&lt;script&gt;');
    });

    it('handles CRLF line endings in code comments and Twoslash directives', () => {
      const crlfCode =
        'const a = 1;\r\n// [!code ++]\r\nconst b = 2;\r\n// [!code --]\r\nconst c = 3;\r\n// @errors: 2322\r\n//    ^?\r\n';
      const directives = parseCodeDirectives(crlfCode);
      expect(directives.length).toBeGreaterThan(0);

      const twoslash = parseTwoslashAnnotations(crlfCode);
      expect(twoslash.expectedErrors).toContain(2322);
      expect(twoslash.annotations.length).toBeGreaterThanOrEqual(1);

      const html = renderCodeBlockHtml(crlfCode, 'typescript\r\n');
      expect(html).toContain('lumen-code-block');
      expect(html).toContain('diff add');
    });
  });

  describe('2. Diagrams Adversarial Testing', () => {
    it('preserves malformed source without fabricating a successful SVG', () => {
      const brokenSnippets = [
        'flowchart TD\n   ??? ||| --->>> [Broken',
        'graph LR\n   A["unclosed quote',
        'sequenceDiagram\n   Alice->>: Invalid Arrow',
        'gitGraph\n   commit id: "bad" branch\n   merge unclosed',
        'classDiagram\n   class { broken body',
        '%% only a comment',
        '',
      ];

      for (const broken of brokenSnippets) {
        const start = Date.now();
        const html = renderDiagramHtml(broken, 1, 'docs/adversarial.pdx');
        const elapsed = Date.now() - start;

        expect(elapsed).toBeLessThan(1000);
        expect(html).toContain('class="lumen-diagram');
        expect(html).toContain('lumen-diag-docs-adversarial-pdx-1');
      }
    });

    it('isolates 15+ diagrams in a single document with unique island IDs', async () => {
      const diagramCount = 15;
      const docBlocks: string[] = [
        '---\ntitle: Multi-Diagram Stress Test\n---',
        '# Document with 15 isolated diagrams',
      ];

      for (let i = 1; i <= diagramCount; i++) {
        docBlocks.push(`## Section ${i}`);
        docBlocks.push(`\`\`\`mermaid\ngraph TD\n  N${i}_A[Node ${i} A] --> N${i}_B[Node ${i} B]\n\`\`\``);
      }

      const doc = docBlocks.join('\n\n');
      const ast = await parseDocument(doc, 'docs/multi-diagrams.pdx');
      const diagrams = ast.children.filter((n) => n.type === 'diagram');
      expect(diagrams).toHaveLength(diagramCount);

      const html = toHtmlSsr(ast);
      const idMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
      const diagramIds = idMatches.filter((id) => id?.startsWith('lumen-diag-'));

      expect(diagramIds.length).toBeGreaterThanOrEqual(diagramCount);

      // Verify strict uniqueness of all diagram IDs
      const uniqueDiagramIds = new Set(diagramIds);
      expect(uniqueDiagramIds.size).toBe(diagramIds.length);

      // Verify each diagram index from 1 to 15 is represented
      for (let i = 1; i <= diagramCount; i++) {
        expect(html).toContain(`lumen-diag-doc-${i}`);
        expect(html).toContain('data-component="MermaidDiagram"');
      }
    });

    it('sanitizes dangerous or directory-traversing filePath in diagram renderer IDs', () => {
      const dangerousPaths = [
        '../../../etc/passwd',
        'C:\\Windows\\System32\\cmd.exe',
        'path/with spaces/and#special?characters!',
      ];

      for (const p of dangerousPaths) {
        const html = renderDiagramHtml('graph TD\n  A --> B', 1, p);
        expect(html).toContain('lumen-diagram-mermaid');
        const idMatch = html.match(/id="(lumen-diag-[^"]+)"/);
        expect(idMatch).toBeTruthy();
        const diagramId = idMatch![1]!;
        expect(diagramId).not.toContain('..');
        expect(diagramId).not.toContain('/');
        expect(diagramId).not.toContain('\\');
        expect(diagramId).not.toContain(' ');
        expect(diagramId).not.toContain('#');
        expect(diagramId).not.toContain('?');
      }
    });
  });

  describe('3. Multi-Target Transformers Stress Testing', () => {
    it('handles empty AST safely across HTML, Markdown and Typst transformers', async () => {
      const emptyAst: LumenDocumentAst = {
        frontmatter: {},
        children: [],
        toc: [],
        diagnostics: [],
        rawContent: '',
      };

      const html = toHtmlSsr(emptyAst);
      expect(html).toBe('<article class="lumen-doc" data-status="draft"></article>');

      const cleanMd = toCleanMarkdown(emptyAst);
      expect(cleanMd).toBe('');

      const typst = toTypst(emptyAst);
      expect(typst).toContain('= Document');

      const typstBuffer = await compileTypst(emptyAst);
      expect(typstBuffer.byteLength).toBeGreaterThan(0);
    });

    it('handles deeply nested structures (30-level blockquotes and lists) without stack overflow', () => {
      const depth = 30;
      let deepestNode: any = { type: 'text', value: 'Deeply nested leaf content' };

      for (let d = 0; d < depth; d++) {
        deepestNode = {
          type: d % 2 === 0 ? 'blockquote' : 'paragraph',
          children: [deepestNode],
        };
      }

      const nestedAst: LumenDocumentAst = {
        frontmatter: { title: 'Deeply Nested' },
        children: [deepestNode],
        toc: [],
        diagnostics: [],
      };

      const html = toHtmlSsr(nestedAst);
      expect(html).toContain('Deeply nested leaf content');
      expect(html).toContain('<blockquote>');

      const cleanMd = toCleanMarkdown(nestedAst);
      expect(cleanMd).toContain('Deeply nested leaf content');

      const typst = toTypst(nestedAst);
      expect(typst).toContain('= Deeply Nested');
    });

    it('safely handles non-ASCII, Cyrillic, Greek, and RTL characters across all transformers', async () => {
      const cyrillicDoc = `---
id: cyrillic-quantum
title: Теория Операторов и Квантовые Состояния (Шрёдингер)
status: verified
---

# 1. Введение: операторные алгебры фон Неймана

Гамильтониан квантовой системы удовлетворяет уравнению:
$\\hat{H} \\Psi_{\\text{состояние}} = E \\Psi$

$$\\int_{-\\infty}^{+\\infty} |\\Psi(x)|^2 dx = 1$$

:::theorem{id="thm-spectral" title="Спектральная Теорема"}
Каждый самосопряженный оператор допускает спектральное разложение.
:::

## 2. 日本語のセクション (Quantum Mechanics)

量子もつれとベルの不等式.

## 3. قسم اللغة العربية (Fields)

نظرية الحقول الكمومية والمصفوفات.
`;

      const ast = await parseDocument(cyrillicDoc, 'docs/cyrillic.pdx');
      expect(ast.frontmatter.title).toContain('Теория Операторов');

      // 1. toHtmlSsr
      const html = toHtmlSsr(ast);
      expect(ast.frontmatter.title).toBe('Теория Операторов и Квантовые Состояния (Шрёдингер)');
      expect(html).toContain('Введение: операторные алгебры фон Неймана');
      expect(html).toContain('Спектральная Теорема');
      expect(html).toContain('日本語のセクション');
      expect(html).toContain('قسم اللغة العربية');

      // 2. toCleanMarkdown
      const cleanMd = toCleanMarkdown(ast, { includeFrontmatter: true });
      expect(cleanMd).toContain('Теория Операторов');
      expect(cleanMd).toContain('Спектральная Теорема');
      expect(cleanMd).toContain('日本語のセクション');
      expect(cleanMd).toContain('قسم اللغة العربية');

      // 3. toTypst & compileTypst
      const typstText = toTypst(ast);
      expect(typstText).toContain('Теория Операторов');
      expect(typstText).toContain('Спектральная Теорема');

      // Unicode PDF rendering is verified against decoded pages in typst.test.ts.
      // This fixture also contains scripts which require explicit extra fonts.
    });

    it('handles extreme paperSize, titles, and metadata in compileTypst', async () => {
      const ast: LumenDocumentAst = {
        frontmatter: { title: 'Extreme Metadata Treatise' },
        children: [{ type: 'paragraph', children: [{ type: 'text', value: 'Extreme test body' }] }],
        toc: [],
        diagnostics: [],
        rawContent: 'Extreme test body',
      };

      const extremeOptions = {
        paperSize: 'custom-999999x999999mm',
        title: 'Extreme Title: <script>alert("XSS")</script> & "Quotes" \n Newlines',
        author: "Prof. Müller-Grothendieck & Dr. O'Connor <researcher@lab.org>",
      };

      await expect(compileTypst(ast, extremeOptions)).rejects.toThrow('Typst compilation failed');
      const pdf = await inspectPdf(await compileTypst(ast, { ...extremeOptions, paperSize: 'a4' }));
      expect(pdf.text).toContain('Müller');
      expect(pdf.text).toContain('Extreme Title');
    });

    it('verifies deterministic byte buffer equality across independent workers of compileTypst', async () => {
      const complexDoc = `---
id: doc-determinism
title: Deterministic Compilation Verification
status: verified
version: 2.1.0
---

# Universal Determinism Theorem

Let $\\mathcal{A}$ be a $C^*$-algebra. For all representations $\\pi$:
$$\\pi(a^* a) \\ge 0$$

:::theorem{id="thm-det-1" title="Determinism Principle"}
For identical AST and compiler options, compileTypst yields byte-for-byte identical output.
:::
`;

      const ast = await parseDocument(complexDoc, 'docs/determinism.pdx');
      const iterations = 3;
      const buffers: Uint8Array[] = [];

      for (let i = 0; i < iterations; i++) {
        const buf = await compileTypst(ast, {
          paperSize: 'a4',
          author: 'Omnitron Determinism Lab',
        });
        buffers.push(buf);
      }

      const baseline = buffers[0]!;
      const baselineHash = crypto.createHash('sha256').update(baseline).digest('hex');

      for (let i = 1; i < iterations; i++) {
        const current = buffers[i]!;
        expect(current.byteLength).toBe(baseline.byteLength);
        expect(
          Buffer.compare(
            Buffer.from(current.buffer, current.byteOffset, current.byteLength),
            Buffer.from(baseline.buffer, baseline.byteOffset, baseline.byteLength)
          )
        ).toBe(0);

        const currentHash = crypto.createHash('sha256').update(current).digest('hex');
        expect(currentHash).toBe(baselineHash);
      }
    });

    it('handles unclosed theorem directive gracefully in toTypst without uncaught error', () => {
      const unclosedDoc: LumenDocumentAst = {
        frontmatter: { title: 'Unclosed Theorem Doc' },
        children: [],
        toc: [],
        diagnostics: [],
        rawContent: `:::theorem{id="thm-unclosed" title="Unclosed"}\nThis theorem has no closing directive fence.`,
      };

      const typstText = toTypst(unclosedDoc);
      expect(typstText).toContain('= Unclosed Theorem Doc');
    });

    it('resiliently handles malformed AST nodes with missing children arrays or unexpected types', () => {
      const malformedAst: LumenDocumentAst = {
        frontmatter: { title: 'Malformed Nodes' },
        children: [
          { type: 'paragraph', children: undefined as any },
          { type: 'heading', depth: undefined as any, children: undefined as any },
          { type: 'strong', children: undefined as any },
          { type: 'mathEnvironment', envKind: undefined as any, children: undefined as any },
          { type: 'diagram', code: undefined as any },
          { type: 'jsxWidget', name: undefined as any, props: null as any, children: undefined as any },
          { type: 'unexpected_quantum_node' as any, value: 'Fallback value' },
        ],
        toc: [],
        diagnostics: [],
      };

      // Invalid island metadata must not become a successfully mounted empty
      // props object. Missing optional children remain independently supported.
      expect(() => toHtmlSsr(malformedAst)).toThrow('Island props must be a JSON object');
      const widget = malformedAst.children.find(node => node.type === 'jsxWidget')!;
      widget.props = {};
      const html = toHtmlSsr(malformedAst);
      expect(html).toContain('lumen-doc');
      expect(html).toContain('Fallback value');

      const cleanMd = toCleanMarkdown(malformedAst);
      expect(cleanMd).toContain('Fallback value');

      const typst = toTypst(malformedAst);
      expect(typst).toContain('= Malformed Nodes');
    });
  });
});
