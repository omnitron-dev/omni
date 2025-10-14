/**
 * @vitest-environment happy-dom
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { Code } from '../../../src/primitives/Code.js';
import { renderComponent } from '../../helpers/test-utils.js';

describe('Code', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  describe('Basic functionality', () => {
    it('should render inline code by default', () => {
      const component = () =>
        Code({
          children: 'useState',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl).toBeTruthy();
      expect(codeEl?.textContent).toBe('useState');
      expect(codeEl?.getAttribute('data-code')).toBe('');
    });

    it('should render inline code with text content', () => {
      const component = () =>
        Code({
          children: 'const x = 1;',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('const x = 1;');
    });

    it('should render inline code without block wrapper', () => {
      const component = () =>
        Code({
          children: 'console.log()',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = container.querySelector('code');

      expect(pre).toBeNull();
      expect(code).toBeTruthy();
    });

    it('should not have data-code-block attribute on inline code', () => {
      const component = () =>
        Code({
          children: 'value',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.hasAttribute('data-code-block')).toBe(false);
      expect(codeEl?.hasAttribute('data-code')).toBe(true);
    });
  });

  describe('Block code', () => {
    it('should render block code with pre wrapper', () => {
      const component = () =>
        Code({
          block: true,
          children: 'const greeting = "Hello";',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = container.querySelector('code');

      expect(pre).toBeTruthy();
      expect(code).toBeTruthy();
      expect(pre?.getAttribute('data-code-block')).toBe('');
    });

    it('should nest code element inside pre', () => {
      const component = () =>
        Code({
          block: true,
          children: 'function hello() {}',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = pre?.querySelector('code');

      expect(code).toBeTruthy();
      expect(code?.textContent).toBe('function hello() {}');
    });

    it('should render multiline code correctly', () => {
      const codeContent = `const greeting = "Hello, World!";
console.log(greeting);`;

      const component = () =>
        Code({
          block: true,
          children: codeContent,
        });

      const { container } = renderComponent(component);

      const code = container.querySelector('code');
      expect(code?.textContent).toBe(codeContent);
    });

    it('should preserve whitespace in block code', () => {
      const codeWithSpaces = `  const x = 1;
  const y = 2;`;

      const component = () =>
        Code({
          block: true,
          children: codeWithSpaces,
        });

      const { container } = renderComponent(component);

      const code = container.querySelector('code');
      expect(code?.textContent).toBe(codeWithSpaces);
    });

    it('should not have data-code attribute on block code', () => {
      const component = () =>
        Code({
          block: true,
          children: 'code content',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      expect(pre?.hasAttribute('data-code')).toBe(false);
      expect(pre?.hasAttribute('data-code-block')).toBe(true);
    });
  });

  describe('Language support', () => {
    it('should apply language attribute to inline code', () => {
      const component = () =>
        Code({
          language: 'typescript',
          children: 'useState',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('data-language')).toBe('typescript');
    });

    it('should apply language attribute to block code', () => {
      const component = () =>
        Code({
          block: true,
          language: 'javascript',
          children: 'const x = 1;',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = pre?.querySelector('code');

      expect(pre?.getAttribute('data-language')).toBe('javascript');
      expect(code?.getAttribute('data-language')).toBe('javascript');
    });

    it('should support various programming languages', () => {
      const languages = ['typescript', 'javascript', 'python', 'rust', 'go', 'java'];

      languages.forEach((lang) => {
        const component = () =>
          Code({
            language: lang,
            children: 'code',
          });

        const { container, cleanup } = renderComponent(component);
        const codeEl = container.querySelector('code');

        expect(codeEl?.getAttribute('data-language')).toBe(lang);
        cleanup();
        document.body.innerHTML = '';
      });
    });

    it('should handle language with block code', () => {
      const component = () =>
        Code({
          block: true,
          language: 'python',
          children: 'def hello():\n    print("Hello")',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = pre?.querySelector('code');

      expect(pre?.getAttribute('data-language')).toBe('python');
      expect(code?.getAttribute('data-language')).toBe('python');
    });

    it('should work without language attribute', () => {
      const component = () =>
        Code({
          children: 'generic code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('data-language')).toBeNull();
    });

    it('should handle empty language string', () => {
      const component = () =>
        Code({
          language: '',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('data-language')).toBe('');
    });
  });

  describe('Custom attributes', () => {
    it('should apply custom className to inline code', () => {
      const component = () =>
        Code({
          class: 'custom-code',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.className).toContain('custom-code');
    });

    it('should apply custom className to block code', () => {
      const component = () =>
        Code({
          block: true,
          class: 'custom-block',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      expect(pre?.className).toContain('custom-block');
    });

    it('should apply custom id attribute', () => {
      const component = () =>
        Code({
          id: 'code-snippet',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.id).toBe('code-snippet');
    });

    it('should apply data attributes', () => {
      const component = () =>
        Code({
          'data-test': 'value',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('data-test')).toBe('value');
    });

    it('should apply style attribute', () => {
      const component = () =>
        Code({
          style: { color: 'red' },
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code') as HTMLElement;
      expect(codeEl?.style.color).toBe('red');
    });

    it('should apply title attribute', () => {
      const component = () =>
        Code({
          title: 'Code snippet',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('title')).toBe('Code snippet');
    });
  });

  describe('Children handling', () => {
    it('should render string children', () => {
      const component = () =>
        Code({
          children: 'Hello World',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('Hello World');
    });

    it('should render numeric children', () => {
      const component = () =>
        Code({
          children: 42,
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('42');
    });

    it('should render empty string', () => {
      const component = () =>
        Code({
          children: '',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('');
    });

    it('should handle special characters', () => {
      const component = () =>
        Code({
          children: '<div>&nbsp;</div>',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('<div>&nbsp;</div>');
    });

    it('should handle unicode characters', () => {
      const component = () =>
        Code({
          children: 'λ => console.log(λ)',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('λ => console.log(λ)');
    });

    it('should handle template literals', () => {
      const name = 'World';
      const component = () =>
        Code({
          children: `Hello ${name}`,
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('Hello World');
    });
  });

  describe('Accessibility', () => {
    it('should use semantic code element', () => {
      const component = () =>
        Code({
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.tagName).toBe('CODE');
    });

    it('should use semantic pre element for blocks', () => {
      const component = () =>
        Code({
          block: true,
          children: 'code',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      expect(pre?.tagName).toBe('PRE');
    });

    it('should be readable by screen readers', () => {
      const component = () =>
        Code({
          children: 'const x = 1;',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('const x = 1;');
      expect(codeEl?.getAttribute('aria-hidden')).toBeNull();
    });

    it('should allow aria-label for additional context', () => {
      const component = () =>
        Code({
          'aria-label': 'JavaScript code example',
          children: 'const x = 1;',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('aria-label')).toBe('JavaScript code example');
    });

    it('should support aria-describedby', () => {
      const component = () =>
        Code({
          'aria-describedby': 'code-description',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.getAttribute('aria-describedby')).toBe('code-description');
    });
  });

  describe('Integration scenarios', () => {
    it('should work in documentation context', () => {
      const component = () =>
        Code({
          children: 'useState',
        });

      const { container } = renderComponent(component);

      // Simulating: Use the <Code>useState</Code> hook
      const codeEl = container.querySelector('code');
      expect(codeEl).toBeTruthy();
      expect(codeEl?.textContent).toBe('useState');
    });

    it('should work with multiple code blocks', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Code({ block: true, language: 'javascript', children: 'const x = 1;' }));
        div.appendChild(Code({ block: true, language: 'python', children: 'x = 1' }));
        return div;
      };

      const { container } = renderComponent(component);

      const blocks = container.querySelectorAll('pre[data-code-block]');
      expect(blocks.length).toBe(2);

      expect(blocks[0]?.getAttribute('data-language')).toBe('javascript');
      expect(blocks[1]?.getAttribute('data-language')).toBe('python');
    });

    it('should work with inline and block code together', () => {
      const component = () => {
        const div = document.createElement('div');
        div.appendChild(Code({ children: 'useState' }));
        div.appendChild(Code({ block: true, children: 'const [state, setState] = useState(0);' }));
        return div;
      };

      const { container } = renderComponent(component);

      const inlineCode = container.querySelector('code[data-code]');
      const blockPre = container.querySelector('pre[data-code-block]');

      expect(inlineCode).toBeTruthy();
      expect(blockPre).toBeTruthy();
    });
  });

  describe('Edge cases', () => {
    it('should handle undefined children', () => {
      const component = () =>
        Code({
          children: undefined,
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl).toBeTruthy();
    });

    it('should handle null children', () => {
      const component = () =>
        Code({
          children: null,
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl).toBeTruthy();
    });

    it('should handle boolean children', () => {
      const component = () =>
        Code({
          children: true,
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl).toBeTruthy();
    });

    it('should toggle between inline and block', () => {
      let isBlock = false;

      const component = () =>
        Code({
          block: isBlock,
          children: 'code',
        });

      const { container } = renderComponent(component);

      // Initially inline
      let codeEl = container.querySelector('code[data-code]');
      let pre = container.querySelector('pre');
      expect(codeEl).toBeTruthy();
      expect(pre).toBeNull();
    });

    it('should handle very long code strings', () => {
      const longCode = 'const x = 1;\n'.repeat(100);

      const component = () =>
        Code({
          block: true,
          children: longCode,
        });

      const { container } = renderComponent(component);

      const code = container.querySelector('code');
      expect(code?.textContent?.length).toBeGreaterThan(1000);
    });

    it('should handle code with only whitespace', () => {
      const component = () =>
        Code({
          children: '   ',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.textContent).toBe('   ');
    });

    it('should handle code with tabs', () => {
      const component = () =>
        Code({
          block: true,
          children: '\tconst x = 1;\n\t\tconst y = 2;',
        });

      const { container } = renderComponent(component);

      const code = container.querySelector('code');
      expect(code?.textContent).toContain('\t');
    });
  });

  describe('Display name', () => {
    it('should have correct display name', () => {
      expect(Code.displayName).toBe('Code');
    });
  });

  describe('Data attributes consistency', () => {
    it('should have data-code on inline code only', () => {
      const component = () =>
        Code({
          children: 'inline',
        });

      const { container } = renderComponent(component);

      const codeEl = container.querySelector('code');
      expect(codeEl?.hasAttribute('data-code')).toBe(true);
      expect(codeEl?.hasAttribute('data-code-block')).toBe(false);
    });

    it('should have data-code-block on pre element only', () => {
      const component = () =>
        Code({
          block: true,
          children: 'block',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = container.querySelector('code');

      expect(pre?.hasAttribute('data-code-block')).toBe(true);
      expect(pre?.hasAttribute('data-code')).toBe(false);
      expect(code?.hasAttribute('data-code-block')).toBe(false);
      expect(code?.hasAttribute('data-code')).toBe(false);
    });

    it('should have data-language on both pre and code in block mode', () => {
      const component = () =>
        Code({
          block: true,
          language: 'typescript',
          children: 'code',
        });

      const { container } = renderComponent(component);

      const pre = container.querySelector('pre');
      const code = container.querySelector('code');

      expect(pre?.getAttribute('data-language')).toBe('typescript');
      expect(code?.getAttribute('data-language')).toBe('typescript');
    });
  });
});
