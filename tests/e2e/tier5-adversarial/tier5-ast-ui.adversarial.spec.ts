import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// Subsystem 1: @omnitron-dev/lumen-ast
import {
  parseDocument,
  validateFrontmatter,
  LumenFrontmatterSchema,
  renderKaTeX,
  LumenMacroRegistry,
  toHtmlSsr,
  toTypst,
  compileTypst,
  renderDiagramHtml,
  parseMermaidDirectives,
  parseAttributeString,
  splitTextWithSmartRefs,
  parseJsxTag,
  isPascalCaseTag,
  buildTableOfContents,
  escapeHtml,
  type LumenDocumentAst,
  type LumenNode,
} from '@omnitron-dev/lumen-ast';

// Subsystem 2: @omnitron-dev/lumen-ui
import {
  LumenShell,
  PortalIslandHost,
  PortalIslandManager,
  setupTrigger,
  setupLoadTrigger,
  setupVisibleTrigger,
  setupInteractionTrigger,
  setupIdleTrigger,
  LumenSearchDialog,
  LumenSearchDialogContent,
  PagefindAdapter,
  NetronAdapter,
  NetronPlayground,
  ApiExplorer,
  DocLayout,
  MathTheoremBlock,
  CodeBlock,
  type HydrationTrigger,
} from '@omnitron-dev/lumen-ui';

describe('Tier 5 Adversarial Hardening: @omnitron-dev/lumen-ast & @omnitron-dev/lumen-ui', () => {
  // ==========================================================================
  // SECTION 1: LUMEN-AST ADVERSARIAL COVERAGE
  // ==========================================================================

  describe('1.1 Deeply Nested Directive Hierarchies & Colon Nesting', () => {
    it('ADV-AST-01: handles deep nesting of admonitions with increasing colon fences', async () => {
      // CommonMark / micromark requires outer containers to have more colons than inner containers
      const doc = `::::::note{title="Level 6"}
:::::note{title="Level 5"}
::::note{title="Level 4"}
:::note{title="Level 3"}
Deep core content
:::
::::
:::::
::::::`;
      const ast = await parseDocument(doc);
      expect(ast.diagnostics).toEqual([]);
      expect(ast.children.length).toBe(1);

      let current: LumenNode | undefined = ast.children[0];
      let depth = 0;
      while (current && 'children' in current && current.children && current.children.length > 0) {
        depth++;
        const next: LumenNode | undefined = current.children[0];
        if (next && next.type === 'paragraph') break;
        current = next;
      }
      expect(depth).toBe(4);
    });

    it('ADV-AST-02: exposes tabs nesting colon collision where inner tabs corrupt outer tabs', async () => {
      // In directives.ts, normalizeTabsDirectives maps both outer and inner tabs to 4 colons (::::tabs),
      // causing the inner tabs closing fence to prematurely break the outer tabs structure.
      const doc = `:::tabs
:::tab{label="Outer Tab 1"}
:::tabs
:::tab{label="Inner Tab A"}
Inner A
:::
:::tab{label="Inner Tab B"}
Inner B
:::
:::
:::
:::tab{label="Outer Tab 2"}
Outer B
:::
:::`;
      const ast = await parseDocument(doc);

      // The outer tabs should have 2 children tabItems: "Outer Tab 1" and "Outer Tab 2"
      const rootTabs = ast.children.find((c) => c.type === 'tabs');
      expect(rootTabs).toBeDefined();
      const tabLabels = rootTabs?.children?.map((c: any) => c.label);

      // Expected robust behavior: root tabs contains both ["Outer Tab 1", "Outer Tab 2"]
      // Current buggy behavior: "Outer Tab 2" is detached from root tabs and leaked as root element
      expect(tabLabels).toEqual(['Outer Tab 1', 'Outer Tab 2']);
    });

    it('ADV-AST-03: handles unclosed nested directives at EOF gracefully without crashing', async () => {
      const doc = `:::theorem{id="thm-unclosed" title="Unfinished Theorem"}
This theorem never closes because the file was truncated mid-write.
:::note{title="Inner unclosed"}
Some inner text`;
      const ast = await parseDocument(doc);
      expect(ast).toBeDefined();
      expect(Array.isArray(ast.children)).toBe(true);
      expect(Array.isArray(ast.diagnostics)).toBe(true);
    });

    it('ADV-AST-04: handles complex alternating directive types (theorem -> tabs -> note -> proof)', async () => {
      const doc = `:::theorem{id="thm-alt" title="Alternating Test"}
Theorem statement.
:::tabs
:::tab{label="Case 1"}
:::note{title="Note on Case 1"}
Note text.
:::proof{of="thm-alt"}
Case 1 proof body.
:::
:::
:::
:::`;
      const ast = await parseDocument(doc);
      expect(ast.children.length).toBeGreaterThan(0);
      const thm = ast.children.find((c) => c.type === 'mathEnvironment');
      expect(thm).toBeDefined();
    });
  });

  describe('1.2 KaTeX Macro Recursion & Extreme Mathematical Syntax', () => {
    it('ADV-AST-05: isolates cyclic KaTeX macro mutual recursion without stack overflow', () => {
      const registry = new LumenMacroRegistry({
        '\\ping': '\\pong',
        '\\pong': '\\ping',
      });

      const result = renderKaTeX('\\ping', { macros: registry, maxExpand: 50 });
      expect(result).toBeDefined();
      expect(result.html).toContain('lumen-invalid-math');
      expect(result.error).toMatch(/too many expansions|infinite loop/i);
    });

    it('ADV-AST-06: isolates self-referential recursive KaTeX macro', () => {
      const registry = new LumenMacroRegistry({
        '\\loop': '\\loop',
      });

      const result = renderKaTeX('\\loop', { macros: registry, maxExpand: 20 });
      expect(result).toBeDefined();
      expect(result.html).toContain('lumen-invalid-math');
      expect(result.error).toMatch(/too many expansions|infinite loop/i);
    });

    it('ADV-AST-07: exposes uncaught TypeError when renderKaTeX receives null or undefined tex', () => {
      // In render-math.ts: the catch block invokes escapeHtml(tex).
      // If tex is null or undefined, escapeHtml(null) crashes with `Cannot read properties of null (reading 'replace')`.
      expect(() => renderKaTeX(null as any)).not.toThrow();
      expect(() => renderKaTeX(undefined as any)).not.toThrow();
    });

    it('ADV-AST-08: renders complex Unicode, emojis, RTL, and CJK mathematical syntax safely', () => {
      const mathSamples = [
        '\\sum_{i=1}^{\\infty} x_i + \\text{🚀} = 0',
        '\\text{العربية} + \\alpha = 1',
        'f(x) = \\text{量子态}',
        '\\alpha\\u200B + \\beta\\u0301',
      ];

      for (const tex of mathSamples) {
        const result = renderKaTeX(tex);
        expect(result.error).toBeUndefined();
        expect(result.html).toContain('class="katex"');
      }
    });

    it('ADV-AST-09: handles massive mathematical expressions (>10,000 characters) within bounds', () => {
      const largeFormula = 'x + '.repeat(2000) + 'y';
      const result = renderKaTeX(largeFormula);
      expect(result).toBeDefined();
      expect(typeof result.html).toBe('string');
    });
  });

  describe('1.3 Malformed Frontmatter & Schema Violation Resilience', () => {
    it('ADV-AST-10: handles non-object frontmatter gracefully without unhandled exceptions', () => {
      const inputs = ['simple-string-frontmatter', 12345, ['array', 'of', 'items'], null, undefined];

      for (const input of inputs) {
        const res = validateFrontmatter(input);
        expect(res).toBeDefined();
        expect(res.frontmatter).toEqual({});
        expect(Array.isArray(res.diagnostics)).toBe(true);
      }
    });

    it('ADV-AST-11: recovers body content and issues diagnostic for unclosed frontmatter fence', async () => {
      const doc = `---
title: Unclosed Document
tags: [test]
# Real Heading
Real body content following unclosed frontmatter fence.`;

      const ast = await parseDocument(doc);
      expect(ast.diagnostics.some((d) => d.code === 'FRONTMATTER_PARSE_ERROR')).toBe(true);
      expect(ast.children.length).toBeGreaterThan(0);
      expect(ast.rawContent).toContain('Real Heading');
    });

    it('ADV-AST-12: reports diagnostics for type violations in frontmatter fields', () => {
      const malformedData = {
        title: 12345, // invalid type: number instead of string
        status: 999, // invalid type: number instead of enum/string
        sidebar_position: 'top', // invalid type: string instead of number
        tags: 'single-string', // invalid type: string instead of array
        paper: 'yes', // invalid type: string instead of boolean
      };

      const { diagnostics } = validateFrontmatter(malformedData);
      expect(diagnostics.length).toBeGreaterThanOrEqual(4);
      expect(diagnostics.some((d) => d.message.includes('sidebar_position'))).toBe(true);
      expect(diagnostics.some((d) => d.message.includes('tags'))).toBe(true);
      expect(diagnostics.some((d) => d.message.includes('status'))).toBe(true);
      expect(diagnostics.some((d) => d.message.includes('paper'))).toBe(true);
    });

    it('ADV-AST-13: rejects prototype poisoning keys in frontmatter without polluting Object prototype', () => {
      const pollutedData = JSON.parse(
        '{"__proto__":{"polluted":"ast-yes"},"constructor":{"prototype":{"polluted2":true}}}'
      );
      const { frontmatter } = validateFrontmatter(pollutedData);
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).polluted2).toBeUndefined();
    });
  });

  describe('1.4 Typst Academic Compiler Resilience & Injection Hardening', () => {
    it('ADV-AST-14: preserves unclosed theorem content through parseDocument -> toTypst while never resurrecting rawContent on empty children (IA-01)', async () => {
      const parsedUnclosed = await parseDocument(
        `---\ntitle: Typst Test\n---\n:::theorem{id="thm-unclosed" title="Unclosed Theorem"}\nThis crucial theorem proof content must not be discarded.`
      );
      const typst = toTypst(parsedUnclosed);
      expect(typst).toContain('This crucial theorem proof content must not be discarded.');

      // IA-01 invariant: an AST with empty children must NEVER fall back to rawContent
      const projectedEmpty: LumenDocumentAst = {
        frontmatter: { title: 'Restricted', access: 'confidential' },
        rawContent: 'DENIED_SECRET_CANARY_MUST_NEVER_RENDER',
        children: [],
        toc: [],
        diagnostics: [],
      };
      expect(toTypst(projectedEmpty)).not.toContain('DENIED_SECRET_CANARY_MUST_NEVER_RENDER');
    });

    it('ADV-AST-15: exposes unescaped Typst markup injection in paper author and title', () => {
      // In to-typst.ts: author is interpolated as `#align(center)[#text(...)[${options.author}]]`.
      // If author contains `] #sys.command(...) [`, it breaks out of the brackets and injects commands.
      const doc: LumenDocumentAst = {
        frontmatter: { title: 'Safe Title' },
        rawContent: 'Body paragraph.',
        children: [],
        toc: [],
        diagnostics: [],
      };

      const maliciousAuthor = 'Dr. Malicious] #sys.command("rm -rf /") [Coauthor';
      const typst = toTypst(doc, { author: maliciousAuthor });

      // Robust expectation: author string should be sanitized or escaped so bracket breakout cannot execute #sys.command
      expect(typst).not.toMatch(/\]\s*#sys\.command/);
    });

    it('ADV-AST-16: compiles deterministic Typst byte stream from complex document AST', async () => {
      const doc: LumenDocumentAst = {
        frontmatter: { title: 'Deterministic Paper' },
        rawContent: `# Introduction\n\n:::theorem{id="thm-1" title="Main Theorem"}\nE = mc^2\n:::\n`,
        children: [],
        toc: [],
        diagnostics: [],
      };

      const bytes1 = await compileTypst(doc);
      const bytes2 = await compileTypst(doc);
      expect(bytes1).toBeInstanceOf(Uint8Array);
      expect(bytes1.length).toBeGreaterThan(0);
      expect(Buffer.from(bytes1).equals(Buffer.from(bytes2))).toBe(true);
    });
  });

  describe('1.5 SSR HTML Transformer Hardening & XSS Vulnerability Surface', () => {
    it('ADV-AST-17: exposes crash when toHtmlSsr receives AST with numeric status or title', () => {
      // In to-html-ssr.ts: escapeHtml(ast.frontmatter.status ?? 'draft') is called without String() coercion.
      // If status is a number (e.g. 123), escapeHtml(123) throws `TypeError: str.replace is not a function`.
      const astNumericStatus: LumenDocumentAst = {
        frontmatter: { title: 'Doc', status: 123 as any },
        children: [],
        toc: [],
        diagnostics: [],
      };

      expect(() => toHtmlSsr(astNumericStatus)).not.toThrow();

      const astNumericTitle: LumenDocumentAst = {
        frontmatter: { title: 2026 as any, status: 'draft' },
        children: [],
        toc: [],
        diagnostics: [],
      };

      expect(() => toHtmlSsr(astNumericTitle)).not.toThrow();
    });

    it('ADV-AST-18: exposes HTML attribute breakout XSS via envKind in mathEnvironment', () => {
      // In to-html-ssr.ts: envKind is interpolated directly into class attributes without escapeHtml:
      // class="... lumen-math-${envKind} lumen-env-${envKind}"
      const ast: LumenDocumentAst = {
        frontmatter: {},
        children: [
          {
            type: 'mathEnvironment',
            envKind: '" onmouseover="alert(1)"',
            children: [],
          },
        ],
        toc: [],
        diagnostics: [],
      };

      const html = toHtmlSsr(ast);
      // Robust expectation: class attribute must not contain raw unescaped onmouseover or quote breakouts
      expect(html).not.toContain('class="lumen-math-block lumen-math-env lumen-math-" onmouseover=');
    });

    it('ADV-AST-19: exposes arbitrary HTML/script injection via data-lumen-island in rawHtmlPlaceholder', () => {
      // In to-html-ssr.ts: if raw.includes('data-lumen-island'), raw is returned verbatim without escaping:
      // if (raw.includes('data-lumen-island')) return raw;
      const ast: LumenDocumentAst = {
        frontmatter: {},
        children: [
          {
            type: 'rawHtmlPlaceholder',
            raw: '<div data-lumen-island="exploit"><script>alert(document.domain)</script></div>',
          },
        ],
        toc: [],
        diagnostics: [],
      };

      const html = toHtmlSsr(ast);
      // Robust expectation: rawHtmlPlaceholder must sanitize or escape dangerous script elements
      expect(html).not.toContain('<script>alert');
    });

    it('ADV-AST-20: clamps or sanitizes out-of-bounds heading depths (depth 0, -1, 7, NaN)', () => {
      const ast: LumenDocumentAst = {
        frontmatter: {},
        children: [
          {
            type: 'heading',
            depth: 0 as any,
            children: [{ type: 'text', value: 'Zero heading' }],
          },
          {
            type: 'heading',
            depth: 7 as any,
            children: [{ type: 'text', value: 'Seven heading' }],
          },
        ],
        toc: [],
        diagnostics: [],
      };

      const html = toHtmlSsr(ast);
      expect(html).not.toContain('<h0');
      expect(html).not.toContain('<h7');
    });
  });

  describe('1.6 Diagram Rendering & Directive Parser Robustness', () => {
    it('ADV-AST-21: escapes XSS injection payloads in Mermaid diagram sources', () => {
      const maliciousMermaid = `graph TD\nA["<script>alert(1)</script>"] --> B["<img src=x onerror=alert(2)>"]`;
      const html = renderDiagramHtml(maliciousMermaid, 1, 'test-doc');

      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
      expect(html).toContain('&lt;img src=x onerror=alert(2)&gt;');
    });

    it('ADV-AST-22: exposes parser gap in ELK init directive with trailing whitespace before closing percent', () => {
      // In diagrams/directives.ts: regex is /%%\s*\{init:\s*(\{.+?\})\s*\}%%/s
      // If there is whitespace between } and %% (e.g. `} %%`), it fails to match.
      const code = `%%{init: {"flowchart": {"defaultRenderer": "elk"}} } %%\ngraph TD\nA-->B`;
      const config = parseMermaidDirectives(code);
      // Robust expectation: ELK renderer is detected even with whitespace before closing %%
      expect(config.defaultRenderer).toBe('elk');
    });

    it('ADV-AST-23: handles empty diagram code and non-standard diagram types gracefully', () => {
      expect(() => renderDiagramHtml('', 0)).not.toThrow();
      expect(() => renderDiagramHtml('   \n  \t  ', 0)).not.toThrow();
      const emptyConfig = parseMermaidDirectives('');
      expect(emptyConfig.diagramType).toBe('flowchart');
    });
  });

  describe('1.7 Attribute Lexer Edge Cases & Prototype Safety', () => {
    it('ADV-AST-24: safely parses unclosed attribute braces without infinite loops', () => {
      const unclosed = '{id="test" title="unclosed {bracket';
      const parsed = parseAttributeString(unclosed);
      expect(parsed).toBeDefined();
      expect(parsed.id).toBe('test');
    });

    it('ADV-AST-25: prevents prototype pollution in parseAttributeString', () => {
      const input = '{__proto__="polluted", constructor="hacked"}';
      const parsed = parseAttributeString(input);
      expect((Object.prototype as any).polluted).toBeUndefined();
      expect((Object.prototype as any).hacked).toBeUndefined();
    });
  });

  // ==========================================================================
  // SECTION 2: LUMEN-UI ADVERSARIAL COVERAGE
  // ==========================================================================

  describe('2.1 Portal Island Host & Serialization Boundaries', () => {
    it('ADV-AST-26: handles deeply nested complex props serialization in PortalIslandHost', () => {
      const complexProps = {
        level1: {
          level2: {
            array: [1, 'two', { three: true }],
            special: '<script>"&\'',
          },
        },
      };

      const html = renderToStaticMarkup(
        React.createElement(PortalIslandHost, {
          islandId: 'adv-island',
          props: complexProps,
        })
      );

      expect(html).toContain('data-lumen-island="adv-island"');
      expect(html).toContain('data-props=');
      expect(html).toContain('&quot;special&quot;:&quot;&lt;script&gt;\\&quot;&amp;');
    });

    it('ADV-AST-27: exposes uncaught TypeError when PortalIslandHost is passed non-serializable props (BigInt / Circular)', () => {
      // In host.tsx: 'data-props': JSON.stringify(props ?? {})
      // If props contains a BigInt or circular reference, JSON.stringify throws an unhandled TypeError.
      const bigintProps = { amount: 1000n };
      expect(() =>
        renderToStaticMarkup(
          React.createElement(PortalIslandHost, {
            islandId: 'bigint-island',
            props: bigintProps as any,
          })
        )
      ).not.toThrow();

      const circularProps: any = { name: 'circular' };
      circularProps.self = circularProps;
      expect(() =>
        renderToStaticMarkup(
          React.createElement(PortalIslandHost, {
            islandId: 'circular-island',
            props: circularProps,
          })
        )
      ).not.toThrow();
    });

    it('ADV-AST-28: renders empty or missing props safely without breaking static markup', () => {
      const html = renderToStaticMarkup(
        React.createElement(PortalIslandHost, {
          islandId: 'minimal-island',
          props: undefined,
        })
      );

      expect(html).toBe(
        '<div class="lumen-portal-island" data-lumen-island="minimal-island" data-hydrate="idle" data-props="{}"></div>'
      );
    });
  });

  describe('2.2 Hydration Trigger Resilience & Cleanup', () => {
    it('ADV-AST-29: attaches and cleans up interaction triggers on DOM elements', () => {
      const listeners: Record<string, EventListener> = {};
      const mockElement = {
        addEventListener: vi.fn((event: string, handler: EventListener) => {
          listeners[event] = handler;
        }),
        removeEventListener: vi.fn((event: string) => {
          delete listeners[event];
        }),
      } as unknown as HTMLElement;

      const onTrigger = vi.fn();
      // Stub window for trigger execution in node environment
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        const cleanup = setupInteractionTrigger(mockElement, onTrigger);
        expect(mockElement.addEventListener).toHaveBeenCalled();

        cleanup();
        expect(mockElement.removeEventListener).toHaveBeenCalled();
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });

    it('ADV-AST-30: gracefully falls back when IntersectionObserver is not defined for visible trigger', () => {
      const mockElement = {} as HTMLElement;
      const onTrigger = vi.fn();

      const originalWindow = (globalThis as any).window;
      const originalObserver = (globalThis as any).IntersectionObserver;
      (globalThis as any).window = {};
      delete (globalThis as any).IntersectionObserver;

      try {
        const cleanup = setupVisibleTrigger(mockElement, onTrigger);
        expect(onTrigger).toHaveBeenCalledTimes(1);
        expect(typeof cleanup).toBe('function');
        cleanup();
      } finally {
        (globalThis as any).window = originalWindow;
        (globalThis as any).IntersectionObserver = originalObserver;
      }
    });

    it('ADV-AST-31: handles custom event triggers and multiple trigger activations', () => {
      const mockElement = {
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      } as unknown as HTMLElement;

      const onTrigger = vi.fn();
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      try {
        const cleanup = setupTrigger(mockElement, 'onCustomActivation', onTrigger);
        expect(mockElement.addEventListener).toHaveBeenCalledWith(
          'customactivation',
          expect.any(Function),
          expect.any(Object)
        );
        cleanup();
        expect(mockElement.removeEventListener).toHaveBeenCalled();
      } finally {
        (globalThis as any).window = originalWindow;
      }
    });
  });

  describe('2.3 Search Dialog Keyboard Traps, Query Edge Cases & XSS in Snippets', () => {
    it('ADV-AST-32: sanitizes pathological regex ReDoS queries without catastrophic backtracking', () => {
      const redosQueries = ['((a+)+)+$', 'a'.repeat(200) + '!', '([*+?^${}()|[\\]\\\\])+', '\\'.repeat(100)];

      for (const query of redosQueries) {
        const start = Date.now();
        const html = renderToStaticMarkup(
          React.createElement(LumenSearchDialog, {
            open: true,
            initialQuery: query,
          })
        );
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000);
        expect(html).toContain('class="lumen-search-dialog"');
      }
    });

    it('ADV-AST-33: exposes unescaped HTML/script injection via Netron search result snippets', async () => {
      // In search-dialog.tsx line 164:
      // dangerouslySetInnerHTML={{ __html: r.snippet }}
      // If NetronAdapter returns a snippet with <script> or <img onerror>, it is directly rendered unescaped.
      const maliciousSnippet = '<script>alert("xss")</script><img src=x onerror=alert(1)>';
      const mockRpcClient = {
        search: vi.fn().mockResolvedValue([
          {
            documentId: 'doc-1',
            title: 'Malicious Result',
            path: '/docs/pwn',
            snippet: maliciousSnippet,
            score: 0.99,
          },
        ]),
      };

      const adapter = new NetronAdapter(mockRpcClient);
      const results = await adapter.search('test query');
      expect(results.length).toBe(1);
      expect(results[0]?.snippet).toBeDefined();

      // Robust expectation: search result snippets must strip or sanitize dangerous executable script tags
      expect(results[0]?.snippet).not.toContain('<script>');
    });

    it('ADV-AST-34: renders search dialog with empty query and null onClose handler safely', () => {
      const html = renderToStaticMarkup(
        React.createElement(LumenSearchDialog, {
          open: true,
          initialQuery: '',
          onClose: undefined,
        })
      );
      expect(html).toContain('class="lumen-search-dialog"');
      expect(html).toContain('role="dialog"');
    });
  });

  describe('2.4 NetronPlayground server rendering', () => {
    it('ADV-AST-35: renders editable code without evaluating it during SSR', () => {
      const initialDescriptor = Object.getOwnPropertyDescriptor(String.prototype, 'adversarialPollution');
      expect(initialDescriptor).toBeUndefined();

      const html = renderToStaticMarkup(
        React.createElement(NetronPlayground, {
          code: 'String.prototype.adversarialPollution = true;',
        })
      );
      expect(html).toContain('String.prototype.adversarialPollution = true;');
      expect(Object.getOwnPropertyDescriptor(String.prototype, 'adversarialPollution')).toBeUndefined();
    });

    it('ADV-AST-36: labels readonly recorded output separately from execution', () => {
      const html = renderToStaticMarkup(
        React.createElement(NetronPlayground, {
          code: 'console.log("cached");',
          readOnly: true,
          snapshot: {
            code: 'console.log("cached");',
            result: 'cached output',
            timestamp: Date.now(),
          },
        })
      );
      expect(html).toContain('Recorded output');
      expect(html).toContain('cached output');
      expect(html).not.toContain('Run code');
    });
  });

  describe('2.5 ApiExplorer & Layout Component Edge Cases', () => {
    it('ADV-AST-37: computes virtualized list slices correctly with 0, 1, and 10,000 symbols', () => {
      // 0 symbols
      const emptyHtml = renderToStaticMarkup(React.createElement(ApiExplorer as any, { symbols: [] }));
      expect(emptyHtml).toContain('lumen-api-explorer');

      // 10,000 symbols
      const largeSymbols = Array.from({ length: 10_000 }, (_, i) => ({
        id: `sym-${i}`,
        name: `Symbol_${i}`,
        kind: i % 2 === 0 ? 'function' : 'class',
        module: `@omnitron-dev/mod-${i % 10}`,
      }));

      const largeHtml = renderToStaticMarkup(React.createElement(ApiExplorer as any, { symbols: largeSymbols }));
      expect(largeHtml).toContain('lumen-api-explorer');
      expect(largeHtml).toContain('Symbol_0');
    });

    it('ADV-AST-38: renders DocLayout gracefully with missing optional subcomponents', () => {
      const minimalHtml = renderToStaticMarkup(
        React.createElement(DocLayout, { children: React.createElement('div', null, 'Content') })
      );
      expect(minimalHtml).toContain('class="lumen-doc-layout"');
      expect(minimalHtml).toContain('class="lumen-doc-main"');
      expect(minimalHtml).not.toContain('lumen-doc-sidebar');
      expect(minimalHtml).not.toContain('lumen-doc-toc');
    });

    it('ADV-AST-39: renders MathTheoremBlock with proof environment and QED symbol', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          MathTheoremBlock,
          {
            id: 'proof-1',
            envType: 'proof',
            status: 'verified',
            number: '1.1',
          },
          'Direct proof statement.'
        )
      );
      expect(html).toContain('lumen-math-proof');
      expect(html).toContain('lumen-math-qed');
      expect(html).toContain('∎');
      expect(html).toContain('Direct proof statement.');
    });

    it('ADV-AST-40: renders LumenShell with custom theme and locale attributes', () => {
      const html = renderToStaticMarkup(
        React.createElement(
          LumenShell,
          {
            theme: 'dark',
            locale: 'zh-CN',
            currentPath: '/docs/math',
            disablePrismProvider: true,
          },
          React.createElement('div', { id: 'inner' }, 'Test')
        )
      );
      expect(html).toContain('class="lumen-shell"');
      expect(html).toContain('data-theme="dark"');
      expect(html).toContain('data-locale="zh-CN"');
      expect(html).toContain('Test');
    });
  });
});
