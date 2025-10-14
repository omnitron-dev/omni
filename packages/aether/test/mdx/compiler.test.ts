/**
 * MDX Compiler Tests
 */

import { describe, test, expect, beforeEach, vi } from 'vitest';
import {
  compileMDX,
  compileMDXSync,
  AetherMDXParser,
  MDXToVNodeTransformer,
  AetherComponentGenerator
} from '../../src/mdx/compiler/index.js';

describe('MDX Compiler', () => {
  describe('Parser', () => {
    let parser: AetherMDXParser;

    beforeEach(() => {
      parser = new AetherMDXParser();
    });

    test('should parse basic markdown', () => {
      const source = '# Hello World\n\nThis is a paragraph.';
      const ast = parser.parse(source);

      expect(ast).toBeDefined();
      expect(ast.type).toBe('root');
      expect(ast.children).toHaveLength(2);
      expect(ast.children[0].type).toBe('heading');
      expect(ast.children[1].type).toBe('paragraph');
    });

    test('should parse MDX with JSX', () => {
      const source = '# Title\n\n<Button>Click me</Button>';
      const ast = parser.parse(source);

      expect(ast).toBeDefined();
      expect(ast.children).toHaveLength(2);
      // Inline JSX elements are wrapped in paragraphs
      expect(ast.children[1].type).toBe('paragraph');
      // The actual JSX element is inside the paragraph
      expect(ast.children[1].children[0].type).toBe('mdxJsxTextElement');
      expect(ast.children[1].children[0].name).toBe('Button');
    });

    test('should extract frontmatter', () => {
      const source = '---\ntitle: Test\nauthor: John\n---\n\n# Content';
      const ast = parser.parse(source);
      const frontmatter = parser.extractFrontmatter(ast);

      expect(frontmatter).toEqual({
        title: 'Test',
        author: 'John'
      });
    });

    test('should extract table of contents', () => {
      const source = '# H1\n\n## H2\n\n### H3\n\n## Another H2';
      const ast = parser.parse(source);
      const toc = parser.extractTOC(ast);

      expect(toc).toHaveLength(4);
      expect(toc[0]).toEqual({
        level: 1,
        title: 'H1',
        id: 'h1'
      });
      expect(toc[1].level).toBe(2);
      expect(toc[2].level).toBe(3);
    });

    test('should handle code blocks', () => {
      const source = '```javascript\nconst x = 1;\n```';
      const ast = parser.parse(source);

      expect(ast.children[0].type).toBe('code');
      expect(ast.children[0].lang).toBe('javascript');
      expect(ast.children[0].value).toBe('const x = 1;');
    });
  });

  describe('Transformer', () => {
    let transformer: MDXToVNodeTransformer;

    beforeEach(() => {
      transformer = new MDXToVNodeTransformer();
    });

    test('should transform text node to VNode', async () => {
      const mdxNode = {
        type: 'text' as const,
        value: 'Hello World'
      };

      const vnode = await transformer.transform(mdxNode);
      expect(vnode).toBeDefined();
      expect(vnode?.type).toBe('text');
      expect(vnode?.text).toBe('Hello World');
    });

    test('should transform element node to VNode', async () => {
      const mdxNode = {
        type: 'element' as const,
        tagName: 'div',
        children: [
          { type: 'text' as const, value: 'Content' }
        ]
      };

      const vnode = await transformer.transform(mdxNode);
      expect(vnode).toBeDefined();
      expect(vnode?.type).toBe('element');
      expect(vnode?.tag).toBe('div');
      expect(vnode?.children).toHaveLength(1);
    });

    test('should detect reactive props', async () => {
      const mdxNode = {
        type: 'mdxJsxFlowElement' as const,
        tagName: 'Button',
        attributes: [
          {
            type: 'mdxJsxAttribute' as const,
            name: 'onClick',
            value: {
              type: 'expression',
              value: '() => count.update(n => n + 1)'
            }
          }
        ]
      };

      const vnode = await transformer.transform(mdxNode);
      const metadata = transformer.getMetadata();

      expect(metadata.hasReactiveContent).toBe(true);
      expect(metadata.reactiveExpressions).toContain('() => count.update(n => n + 1)');
    });
  });

  describe('Generator', () => {
    let generator: AetherComponentGenerator;

    beforeEach(() => {
      generator = new AetherComponentGenerator();
    });

    test('should generate component code', () => {
      const vnodes = [
        {
          type: 'element' as any,
          tag: 'div',
          children: [
            { type: 'text' as any, text: 'Hello' }
          ]
        }
      ];

      const code = generator.generate(vnodes, {});

      expect(code).toContain('import { defineComponent }');
      expect(code).toContain('export default');
      expect(code).toContain('MDXContent');
    });

    test('should generate reactive component code', () => {
      const vnodes = [
        {
          type: 'text' as any,
          text: '',
          data: {
            isReactive: true,
            expression: 'count()'
          }
        }
      ];

      const code = generator.generate(vnodes, {
        hasReactiveContent: true
      });

      expect(code).toContain('import { signal, computed, effect }');
      expect(code).toContain('createTextVNode');
      expect(code).toContain('count()');
    });
  });

  describe('Full Compilation', () => {
    test('should compile basic markdown', async () => {
      const source = '# Hello MDX\n\nThis is a test.';
      const module = await compileMDX(source);

      expect(module).toBeDefined();
      expect(module.code).toBeDefined();
      expect(module.default).toBeDefined();
    });

    test('should compile MDX with JSX synchronously', () => {
      const source = '# Title\n\n<Button>Click</Button>';
      const module = compileMDXSync(source);

      expect(module).toBeDefined();
      // Check that the code is generated
      expect(module.code).toBeDefined();
      expect(module.code).toContain('MDXContent');
      // The code should contain JSX elements
      expect(module.code).toContain('jsx');
    });

    test('should handle compilation errors gracefully', async () => {
      const source = '<InvalidJSX';

      // Should not throw, but log error
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await expect(compileMDX(source)).rejects.toThrow();

      consoleSpy.mockRestore();
    });

    test('should compile with custom options', async () => {
      const source = '# Test\n\n$$x = y$$';
      const module = await compileMDX(source, {
        math: true,
        gfm: true
      });

      expect(module).toBeDefined();
    });

    test('should extract and include frontmatter', async () => {
      const source = '---\ntitle: My Post\ndate: 2024-01-01\n---\n\n# Content';
      const module = await compileMDX(source);

      expect(module.frontmatter).toEqual({
        title: 'My Post',
        date: '2024-01-01'
      });
    });
  });
});