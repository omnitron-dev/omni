import { describe, expect, it } from 'vitest';
import {
  compileTypst,
  computeTocFromNodes,
  LumenHighlighter,
  MAX_DOCUMENT_BYTES,
  MAX_FRONTMATTER_BYTES,
  MermaidWorkerPool,
  parseAttributeString,
  parseDocument,
  parseJsxTag,
  parseSafeFrontmatter,
  parseTwoslashAnnotations,
  renderCodeBlockHtml,
  renderDiagramHtml,
  sanitizeUrl,
  toCleanMarkdown,
  toHtmlSsr,
  toTipTapDoc,
  toTypst,
  validateFrontmatter,
  type LumenDocumentAst,
} from '../src/index.js';

describe('Architectural Gaps & Independent Security Audit Verification', () => {
  describe('GAP-01: Real Shiki Dual-Theme Highlighting & Real TypeScript Twoslash QuickInfo', () => {
    it('tokenizes all 12 static Shiki grammars with dual github-light and github-dark CSS variables', () => {
      const highlighter = new LumenHighlighter();
      const samples: Array<[string, string]> = [
        ['typescript', 'export const answer: number = 42;'],
        ['tsx', 'export const View = () => <div className="box">Hi</div>;'],
        ['javascript', 'function sum(a, b) { return a + b; }'],
        ['jsx', 'const el = <button disabled>Click</button>;'],
        ['json', '{"kernel": "lumen", "version": 2}'],
        ['bash', 'echo "building workspace" && ls -la'],
        ['rust', 'pub fn norm(v: &[f64]) -> f64 { v.iter().sum() }'],
        ['python', 'def trace(matrix: list[list[float]]) -> float:\n    return 1.0'],
        ['css', '.lumen-card { display: grid; color: #0f172a; }'],
        ['html', '<section class="hero"><h1>Title</h1></section>'],
        ['yaml', 'id: doc-1\nstatus: canonical'],
        ['markdown', '# Heading\n\n**Bold** text.'],
      ];

      for (const [lang, snippet] of samples) {
        const html = highlighter.highlight(snippet, { language: lang });
        expect(html).toContain('class="lumen-code-block');
        expect(html).toContain('shiki');
        expect(html).toContain('--shiki-light:');
        expect(html).toContain('--shiki-dark:');
      }
    });

    it('resolves real TypeScript inferred QuickInfo types and TS compiler diagnostics in Twoslash', () => {
      const code = `const matrix = [[1, 2], [3, 4]];
//    ^?
function makePair<T>(item: T): ReadonlyArray<T> {
  return [item, item];
}
const pair = makePair("omega");
//    ^?`;

      const res = parseTwoslashAnnotations(code);
      expect(res.annotations).toHaveLength(2);
      expect(res.annotations[0]?.text).toContain('const matrix: number[][]');
      expect(res.annotations[1]?.text).toContain('const pair: readonly string[]');
      expect(res.actualErrors).toEqual([]);
      expect(res.errorsValid).toBe(true);

      const html = renderCodeBlockHtml(code, 'ts', 'twoslash');
      expect(html).toContain('lumen-twoslash-popup');
      expect(html).toContain('const matrix: number[][]');

      const errorCode = `// @errors: 2322
const strictCount: number = "invalid-number";`;
      const errRes = parseTwoslashAnnotations(errorCode);
      expect(errRes.actualErrors).toContain(2322);
      expect(errRes.errorsValid).toBe(true);

      const mismatchRes = parseTwoslashAnnotations(`// @errors: 9999\nconst bad: number = "nope";`);
      expect(mismatchRes.actualErrors).toContain(2322);
      expect(mismatchRes.errorsValid).toBe(false);
    });
  });

  describe('GAP-02: Real Deterministic Build-Time SVG Diagram Engine & MermaidWorkerPool', () => {
    it('renders real SVG nodes, shapes, edges, markers, and ELK orthogonal geometry', () => {
      const flowchart = `%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%
flowchart LR
  Start((Init)) --> Check{Valid?}
  Check -->|Yes| Run[Execute]
  Check -.->|No| Halt(Stop)`;

      const fcHtml = renderDiagramHtml(flowchart, 1, 'docs/elk.pdx');
      expect(fcHtml).toContain('data-renderer="elk"');
      expect(fcHtml).toContain('<defs>');
      expect(fcHtml).toContain('<marker');
      expect(fcHtml).toContain('class="lumen-diagram-edges"');
      expect(fcHtml).toContain('class="lumen-edge-path"');
      expect(fcHtml).toContain('class="lumen-diagram-nodes"');
      expect(fcHtml).toContain('class="lumen-node"');
      expect(fcHtml).toContain('<polygon');
      expect(fcHtml).toContain('<circle');
      expect(fcHtml).toContain('<rect');

      const sequence = `sequenceDiagram
  Client->>Gateway: Authenticate
  Gateway-->>Client: SessionToken`;
      const seqHtml = renderDiagramHtml(sequence, 2, 'docs/seq.pdx');
      expect(seqHtml).toContain('data-diagram-type="sequence"');
      expect(seqHtml).toContain('Authenticate');
      expect(seqHtml).toContain('SessionToken');
      expect(seqHtml).toContain('class="lumen-edge-path"');

      const state = `stateDiagram-v2
  [*] --> Idle
  Idle --> Active : trigger
  Active --> [*]`;
      const stateHtml = renderDiagramHtml(state, 3, 'docs/state.pdx');
      expect(stateHtml).toContain('data-diagram-type="state"');
      expect(stateHtml).toContain('Idle');
      expect(stateHtml).toContain('Active');
    });

    it('renders diagram batches asynchronously through bounded MermaidWorkerPool', async () => {
      const pool = new MermaidWorkerPool({ concurrency: 2, maxQueueSize: 32 });
      try {
        const results = await pool.renderBatch([
          { code: 'graph TD\n  A[Alpha] --> B[Beta]', diagramIndex: 1, filePath: 'docs/p1.pdx' },
          { code: 'sequenceDiagram\n  A->>B: Ping', diagramIndex: 2, filePath: 'docs/p2.pdx' },
          { code: 'stateDiagram-v2\n  [*] --> Ready', diagramIndex: 3, filePath: 'docs/p3.pdx' },
        ]);

        expect(results).toHaveLength(3);
        expect(results[0]).toContain('Alpha');
        expect(results[1]).toContain('Ping');
        expect(results[2]).toContain('Ready');
      } finally {
        await pool.shutdown();
      }
    });
  });

  describe('GAP-03, SEC-06 & IA-03: Typed AST toTypst, Injection Hardening & Valid %PDF-1.4 Binary', () => {
    it('neutralizes Typst code-mode directives (#read, #sys, #eval, label & paperSize breakouts)', async () => {
      const maliciousDoc = `---
title: 'Paper ] #read("/etc/passwd") ['
---

# Section #sys.inputs

Attempted code mode: #eval("1+1") and #import "evil.typ": * and $x #read("secret")$.

:::theorem{id='thm-1> #panic("pwned") <x' title='Title ] #sys.version ['}
Body with @malicious_label and [unbalanced] brackets.
:::
`;
      const ast = await parseDocument(maliciousDoc, 'docs/sec-typst.pdx');
      const typst = toTypst(ast, {
        paperSize: 'a4")\n#read("/etc/passwd")\n//',
        author: 'Evil] #panic("author") [',
      });

      expect(typst).toContain('#set page(paper: "a4")');
      expect(typst).not.toMatch(/(?<!\\)#read\(/);
      expect(typst).toContain('\\#read(');
      expect(typst).toContain('\\#eval(');
      expect(typst).toContain('\\#sys.inputs');
      expect(typst).not.toMatch(/\]\s*#panic/);
      expect(typst).not.toMatch(/>\s*#panic/);
    });

    it('emits a spec-valid %PDF-1.4 binary with verified byte-exact xref offsets, trailer, and %%EOF', async () => {
      const doc = `---
title: Spec Valid PDF Test
---

# Introduction

Formal verification of binary PDF 1.4 object offsets.

:::theorem{id="thm-pdf" title="Xref Byte Integrity"}
Every xref offset points to the exact object header byte.
:::
`;
      const ast = await parseDocument(doc, 'docs/pdf-spec.pdx');
      const pdfBytes = await compileTypst(ast, { paperSize: 'a4', author: 'Audit Suite' });
      const rawLatin1 = Buffer.from(pdfBytes).toString('latin1');

      // 1. %PDF-1.4 header at byte 0
      expect(rawLatin1.startsWith('%PDF-1.4\n')).toBe(true);
      expect(rawLatin1.endsWith('%%EOF\n')).toBe(true);

      // 2. Verify startxref points to exact byte offset of `xref\n`
      const startXrefMatch = rawLatin1.match(/startxref\n(\d+)\n%%EOF\n$/);
      expect(startXrefMatch).toBeTruthy();
      const xrefOffset = Number(startXrefMatch![1]);
      expect(Buffer.from(pdfBytes.subarray(xrefOffset, xrefOffset + 5)).toString('ascii')).toBe('xref\n');

      // 3. Verify every in-use 20-byte xref entry points to `<id> 0 obj`
      const xrefSection = Buffer.from(pdfBytes.subarray(xrefOffset)).toString('ascii');
      const lines = xrefSection.split('\n');
      const headerParts = (lines[1] ?? '').split(' ');
      const count = Number(headerParts[1]);
      expect(count).toBeGreaterThanOrEqual(8);

      const freeEntry = `${lines[2]}\n`;
      expect(freeEntry.length).toBe(20);

      for (let objId = 1; objId < count; objId++) {
        const entryLine = `${lines[2 + objId]}\n`;
        expect(entryLine.length).toBe(20);
        const objByteOffset = Number(entryLine.slice(0, 10));
        const sliceAtOffset = Buffer.from(pdfBytes.subarray(objByteOffset, objByteOffset + 16)).toString('ascii');
        expect(sliceAtOffset.startsWith(`${objId} 0 obj\n`)).toBe(true);
      }
    });
  });

  describe('GAP-04 & SEC-08: TypeScript TSX AST Prop Parser & Recursive JSX Children', () => {
    it('parses > inside string props, allows "Main window" & nested objects, and flags unsafe JS expressions', async () => {
      const safeTag = parseJsxTag(
        `<InteractivePlot title="Main window: a > b" badge="x /> y" config={{ label: "window", axes: [1, 2, true], mode: "eval" }} />`
      );
      expect(safeTag.diagnostics).toEqual([]);
      expect(safeTag.node.type).toBe('jsxWidget');
      if (safeTag.node.type === 'jsxWidget') {
        expect(safeTag.node.props['title']).toBe('Main window: a > b');
        expect(safeTag.node.props['badge']).toBe('x /> y');
        expect(safeTag.node.props['config']).toEqual({
          label: 'window',
          axes: [1, 2, true],
          mode: 'eval',
        });
      }

      const unsafeTag = parseJsxTag(
        `<DangerWidget safe="ok" onClick={() => fetch('https://evil.example')} leak={window.location.href} />`,
        'docs/unsafe.pdx'
      );
      expect(unsafeTag.diagnostics.length).toBe(2);
      expect(unsafeTag.diagnostics.every((d) => d.code === 'JSX_UNSAFE_EXPRESSION')).toBe(true);
      if (unsafeTag.node.type === 'jsxWidget') {
        expect(unsafeTag.node.props['safe']).toBe('ok');
        expect(unsafeTag.node.props['onClick']).toBeUndefined();
        expect(unsafeTag.node.props['leak']).toBeUndefined();
      }

      const docWithNestedJsx = `---
title: Nested JSX Document
---

<Callout variant="info" count={3}>
  ## Inner Heading

  Paragraph with **bold** text and <Badge label="v2" /> inline.
</Callout>
`;
      const ast = await parseDocument(docWithNestedJsx, 'docs/nested-jsx.pdx');
      const callout = ast.children.find((n) => n.type === 'jsxWidget');
      expect(callout).toBeDefined();
      expect(callout?.children?.some((c) => c.type === 'heading')).toBe(true);

      const html = toHtmlSsr(ast);
      expect(html).toContain('Inner Heading');
      expect(html).toContain('<strong>bold</strong>');
      expect(html).toContain('data-component="Callout"');
    });
  });

  describe('SEC-03 & IA-06: SSR URL Sanitization, Raw Island XSS Hardening, and Unified Island Contract', () => {
    it('blocks dangerous URL schemes and entity/whitespace obfuscation in sanitizeUrl and toHtmlSsr', async () => {
      expect(sanitizeUrl('javascript:alert(1)')).toBe('#unsafe-url');
      expect(sanitizeUrl('  JaVa\tScRiPt\n:alert(1)')).toBe('#unsafe-url');
      expect(sanitizeUrl('&#106;avascript:alert(1)')).toBe('#unsafe-url');
      expect(sanitizeUrl('&#x6A;avascript:alert(1)')).toBe('#unsafe-url');
      expect(sanitizeUrl('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==')).toBe('#unsafe-url');
      expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('#unsafe-url');
      expect(sanitizeUrl('file:///etc/passwd')).toBe('#unsafe-url');

      expect(sanitizeUrl('https://omnitron.dev/docs')).toBe('https://omnitron.dev/docs');
      expect(sanitizeUrl('/docs/getting-started#install')).toBe('/docs/getting-started#install');
      expect(sanitizeUrl('#thm-1')).toBe('#thm-1');
      expect(sanitizeUrl('mailto:security@omnitron.dev')).toBe('mailto:security@omnitron.dev');

      const xssDoc = `[Click me](javascript:alert(document.cookie))\n\n![Evil](data:text/html,<script>alert(1)</script>)`;
      const ast = await parseDocument(xssDoc);
      const html = toHtmlSsr(ast);
      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('data:text/html');
      expect(html).toContain('href="#unsafe-url"');
      expect(html).toContain('src="#unsafe-url"');
    });

    it('strips event handlers, disallowed tags, nested scripts/SVGs, and trailing breakouts from data-lumen-island', () => {
      const maliciousAst: LumenDocumentAst = {
        frontmatter: { title: 'Island XSS Test' },
        children: [
          {
            type: 'rawHtmlPlaceholder',
            raw: '<img data-lumen-island="bad-tag" src="x" onerror="alert(1)" />',
          },
          {
            type: 'rawHtmlPlaceholder',
            raw: '<div data-lumen-island="safe-id" onclick="alert(1)" data-evil="nope" class="island-box">Plain text<svg onload="alert(2)"></svg><script>evil()</script></div><script>trailing()</script>',
          },
        ],
        toc: [],
        diagnostics: [],
      };

      const html = toHtmlSsr(maliciousAst);
      expect(html).not.toContain('<img data-lumen-island');
      expect(html).not.toContain('onclick=');
      expect(html).not.toContain('data-evil=');
      expect(html).not.toContain('<svg');
      expect(html).not.toContain('<script>');
      expect(html).toContain('<div data-lumen-island="safe-id" class="island-box">Plain text</div>');
    });

    it('emits unified PortalIslandManager discovery attributes on jsxWidget in toHtmlSsr (IA-06)', async () => {
      const ast = await parseDocument(`<Counter initial={10} />\n\n<Chart client:hydrate="visible" />`);
      const html = toHtmlSsr(ast);

      expect(html).toContain('class="lumen-widget lumen-portal-island"');
      expect(html).toContain('data-widget="Counter"');
      expect(html).toContain('data-lumen-island="lumen-widget-1-Counter"');
      expect(html).toContain('data-component="Counter"');
      expect(html).toContain('data-hydrate="interaction"');

      expect(html).toContain('data-lumen-island="lumen-widget-2-Chart"');
      expect(html).toContain('data-component="Chart"');
      expect(html).toContain('data-hydrate="visible"');
    });
  });

  describe('IA-10, IA-11 & IA-02: Safe Frontmatter, Fail-Closed Access, Lexer Termination & AST ToC', () => {
    it('blocks executable frontmatter engines (js, javascript, coffee, toml) before gray-matter (IA-10)', async () => {
      let sideEffectTriggered = false;
      (globalThis as Record<string, unknown>)['__lumenRceProbe'] = () => {
        sideEffectTriggered = true;
      };

      try {
        for (const fence of ['---js', '---javascript', '--- js', '---coffee', '---toml']) {
          const payload = `${fence}\nmodule.exports = { title: globalThis.__lumenRceProbe() }\n---\n# Body`;
          const res = parseSafeFrontmatter(payload, 'docs/rce.pdx');
          expect(sideEffectTriggered).toBe(false);
          expect(res.diagnostics.some((d) => d.code === 'EXECUTABLE_FRONTMATTER_FORBIDDEN')).toBe(true);
          expect(res.frontmatter.access).toBe('restricted');

          const ast = await parseDocument(payload, 'docs/rce.pdx');
          expect(ast.diagnostics.some((d) => d.code === 'EXECUTABLE_FRONTMATTER_FORBIDDEN')).toBe(true);
          expect(ast.frontmatter.access).toBe('restricted');
        }
      } finally {
        delete (globalThis as Record<string, unknown>)['__lumenRceProbe'];
      }
    });

    it('enforces frontmatter (64 KiB) and document (10 MiB) size caps cleanly (IA-10)', () => {
      const hugeFm = `---\ntitle: "${'a'.repeat(MAX_FRONTMATTER_BYTES + 1024)}"\n---\n# Body`;
      const fmRes = parseSafeFrontmatter(hugeFm, 'docs/huge-fm.pdx');
      expect(fmRes.diagnostics.some((d) => d.code === 'FRONTMATTER_TOO_LARGE')).toBe(true);
      expect(fmRes.frontmatter.access).toBe('restricted');

      const hugeDoc = `# Heading\n${'x'.repeat(MAX_DOCUMENT_BYTES + 128)}`;
      const docRes = parseSafeFrontmatter(hugeDoc, 'docs/huge-doc.pdx');
      expect(docRes.diagnostics.some((d) => d.code === 'DOCUMENT_TOO_LARGE')).toBe(true);
      expect(docRes.frontmatter.access).toBe('restricted');
    });

    it('fails closed on invalid frontmatter access values with FRONTMATTER_INVALID_ACCESS (IA-10)', () => {
      const invalidCases: unknown[] = ['top-secret', 123, '', '   ', null, ['public'], 'PUBLIC'];
      for (const badAccess of invalidCases) {
        const { frontmatter, diagnostics } = validateFrontmatter({ title: 'Doc', access: badAccess }, 'docs/acl.pdx');
        expect(diagnostics.some((d) => d.code === 'FRONTMATTER_INVALID_ACCESS' && d.severity === 'error')).toBe(true);
        expect(frontmatter.access).toBeDefined();
        expect(String(frontmatter.access).toLowerCase()).not.toBe('public');
        expect(String(frontmatter.access).trim().length).toBeGreaterThan(0);
      }
    });

    it('guarantees strict O(N) termination and depth budget on adversarial attribute strings (IA-11)', () => {
      const adversarialInputs = [
        '{items=[}]}',
        '{items=[}}}}}]}',
        '{a=[,,,] b={{{}}} c=[1, }, 2]}',
        `{deep=${'['.repeat(40)}1${']'.repeat(40)}}`,
        `{huge="${'x'.repeat(30_000)}"}`,
      ];

      const start = Date.now();
      for (const raw of adversarialInputs) {
        const parsed = parseAttributeString(raw);
        expect(parsed).toBeDefined();
      }
      expect(Date.now() - start).toBeLessThan(200);
    });

    it('preserves access & attributes on directive nodes and propagates ancestor access to ToC (IA-02)', async () => {
      const doc = `---
title: Scoped Document
---

# Public Overview

\`\`\`bash
# Bash comment inside code fence must not appear in ToC
\`\`\`

:::note{title="Internal Note" access="internal"}
## Internal Design Heading
Internal details.
:::

:::theorem{id="thm-secret" title="Classified Lemma" access="confidential"}
### Secret Theorem Subheading
Top secret equation.
:::

:::tabs{syncKey="env" access="internal"}
:::tab{label="Prod" access="confidential"}
#### Prod Secret Config
:::
:::
`;
      const ast = await parseDocument(doc, 'docs/scoped.pdx');

      const admon = ast.children.find((n) => n.type === 'admonition');
      expect(admon?.access).toBe('internal');
      expect(admon?.attributes?.['access']).toBe('internal');

      const thm = ast.children.find((n) => n.type === 'mathEnvironment');
      expect(thm?.access).toBe('confidential');
      expect(thm?.attributes?.['access']).toBe('confidential');

      const tabs = ast.children.find((n) => n.type === 'tabs');
      expect(tabs?.access).toBe('internal');
      expect(tabs?.children?.[0]?.access).toBe('confidential');

      expect(ast.toc).toEqual([
        { id: 'public-overview', title: 'Public Overview', level: 1 },
        { id: 'internal-design-heading', title: 'Internal Design Heading', level: 2, access: 'internal' },
        { id: 'secret-theorem-subheading', title: 'Secret Theorem Subheading', level: 3, access: 'confidential' },
        { id: 'prod-secret-config', title: 'Prod Secret Config', level: 4, access: 'confidential' },
      ]);

      // Verify computeTocFromNodes recomputation after filtering out non-public nodes
      const publicOnlyChildren = ast.children.filter((n) => !n.access || n.access === 'public');
      expect(computeTocFromNodes(publicOnlyChildren)).toEqual([
        { id: 'public-overview', title: 'Public Overview', level: 1 },
      ]);

      // Verify IA-01 across all 4 transformers + compileTypst when children are redacted to []
      const fullyRedacted: LumenDocumentAst = {
        ...ast,
        frontmatter: { title: 'Restricted', access: 'confidential' },
        children: [],
        toc: [],
      };
      expect(toHtmlSsr(fullyRedacted)).not.toContain('Top secret equation');
      expect(toCleanMarkdown(fullyRedacted)).not.toContain('Top secret equation');
      expect(JSON.stringify(toTipTapDoc(fullyRedacted))).not.toContain('Top secret equation');
      expect(toTypst(fullyRedacted)).not.toContain('Top secret equation');
      const redactedPdf = new TextDecoder().decode(await compileTypst(fullyRedacted));
      expect(redactedPdf).not.toContain('Top secret equation');
    });
  });
});
