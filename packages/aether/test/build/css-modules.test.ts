/**
 * Tests for CSS Modules Support
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CSSModulesProcessor,
  createCSSModulesProcessor,
  extractClassNames,
  hasGlobalClasses,
  hasComposition,
  type CSSModulesConfig,
} from '../../src/build/css-modules.js';

describe('CSSModulesProcessor', () => {
  let processor: CSSModulesProcessor;

  beforeEach(() => {
    processor = new CSSModulesProcessor({
      dev: false,
      generateScopedName: '[hash:base64:8]',
    });
  });

  describe('shouldProcess', () => {
    it('should detect .module.css files', () => {
      expect(processor.shouldProcess('Button.module.css')).toBe(true);
    });

    it('should detect .module.scss files', () => {
      expect(processor.shouldProcess('Button.module.scss')).toBe(true);
    });

    it('should detect .module.less files', () => {
      expect(processor.shouldProcess('Button.module.less')).toBe(true);
    });

    it('should not process regular CSS files', () => {
      expect(processor.shouldProcess('global.css')).toBe(false);
    });

    it('should support custom regex', () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          auto: /\.custom\.css$/,
        },
      });

      expect(customProcessor.shouldProcess('Button.custom.css')).toBe(true);
      expect(customProcessor.shouldProcess('Button.module.css')).toBe(false);
    });

    it('should support predicate function', () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          auto: (id: string) => id.includes('scoped'),
        },
      });

      expect(customProcessor.shouldProcess('Button.scoped.css')).toBe(true);
      expect(customProcessor.shouldProcess('Button.module.css')).toBe(false);
    });
  });

  describe('process', () => {
    it('should process simple CSS module', async () => {
      const css = `
        .button {
          color: blue;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button');
      expect(module.processedCSS).toContain('.');
      expect(module.exportCode).toContain('export');
    });

    it('should generate scoped class names', async () => {
      const css = `
        .button {
          color: blue;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      const scopedName = module.locals['button'];
      expect(scopedName).toBeDefined();
      expect(scopedName).not.toBe('button');
      expect(module.processedCSS).toContain(`.${scopedName}`);
    });

    it('should handle multiple classes', async () => {
      const css = `
        .button {
          color: blue;
        }
        .icon {
          size: 16px;
        }
        .label {
          font-size: 14px;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(Object.keys(module.locals)).toHaveLength(3);
      expect(module.locals).toHaveProperty('button');
      expect(module.locals).toHaveProperty('icon');
      expect(module.locals).toHaveProperty('label');
    });

    it('should handle :global() wrapper', async () => {
      const css = `
        .button {
          color: blue;
        }
        :global(.global-class) {
          color: red;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button');
      expect(module.globals.has('global-class')).toBe(true);
      expect(module.processedCSS).toContain('.global-class');
      expect(module.processedCSS).not.toContain(':global');
    });

    it('should handle :global block', async () => {
      const css = `
        .button {
          color: blue;
        }
        :global {
          .global-class {
            color: red;
          }
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.globals.has('global-class')).toBe(true);
    });

    it('should cache processed modules', async () => {
      const css = `.button { color: blue; }`;

      const module1 = await processor.process('Button.module.css', css);
      const module2 = await processor.process('Button.module.css', css);

      expect(module1).toBe(module2);
    });

    it('should invalidate cache on content change', async () => {
      const css1 = `.button { color: blue; }`;
      const css2 = `.button { color: red; }`;

      const module1 = await processor.process('Button.module.css', css1);
      const module2 = await processor.process('Button.module.css', css2);

      expect(module1).not.toBe(module2);
    });
  });

  describe('class name generation', () => {
    it('should use pattern with [local]', async () => {
      const customProcessor = new CSSModulesProcessor({
        generateScopedName: '[local]__[hash:base64:5]',
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toMatch(/^button__[a-zA-Z0-9_-]{5}$/);
    });

    it('should use pattern with [name]', async () => {
      const customProcessor = new CSSModulesProcessor({
        generateScopedName: '[name]__[local]',
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toBe('Button__button');
    });

    it('should use pattern with [hash]', async () => {
      const customProcessor = new CSSModulesProcessor({
        generateScopedName: '[hash:base64:8]',
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toMatch(/^[a-zA-Z0-9_-]{8}$/);
    });

    it('should support custom hash length', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          hashLength: 10,
        },
        generateScopedName: '[hash:base64:10]',
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toMatch(/^[a-zA-Z0-9_-]{10}$/);
    });

    it('should support custom function', async () => {
      const customProcessor = new CSSModulesProcessor({
        generateScopedName: (name, filename) => {
          const baseName = filename.split('/').pop()?.replace('.module.css', '');
          return `${baseName}_${name}_scoped`;
        },
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toBe('Button_button_scoped');
    });

    it('should generate consistent hashes', async () => {
      const css = `.button { color: blue; }`;

      const module1 = await processor.process('Button.module.css', css);
      const module2 = await processor.process('Button.module.css', css);

      expect(module1.locals['button']).toBe(module2.locals['button']);
    });

    it('should generate different hashes for different files', async () => {
      const css = `.button { color: blue; }`;

      const module1 = await processor.process('Button.module.css', css);
      const module2 = await processor.process('Link.module.css', css);

      expect(module1.locals['button']).not.toBe(module2.locals['button']);
    });
  });

  describe('export generation', () => {
    it('should generate named exports', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          namedExport: true,
        },
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('export const button');
      expect(module.exportCode).toContain('export default');
    });

    it('should generate default export only', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          namedExport: false,
        },
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).not.toContain('export const');
      expect(module.exportCode).toContain('export default');
    });

    it('should support camelCase convention', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          exportLocalsConvention: 'camelCase',
        },
      });

      const css = `.button-primary { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('buttonPrimary');
    });

    it('should support dashes convention', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          exportLocalsConvention: 'dashes',
        },
      });

      const css = `.button-primary { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('button-primary');
    });

    it('should support camelCaseOnly convention', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          exportLocalsConvention: 'camelCaseOnly',
        },
      });

      const css = `.button-primary { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('buttonPrimary');
      expect(module.exportCode).not.toContain('button-primary');
    });

    it('should support asIs convention', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          exportLocalsConvention: 'asIs',
        },
      });

      const css = `.button-primary { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('button-primary');
    });

    it('should export globals when configured', async () => {
      const customProcessor = new CSSModulesProcessor({
        exportGlobals: true,
      });

      const css = `
        .button { color: blue; }
        :global(.global-class) { color: red; }
      `;

      const module = await customProcessor.process('Button.module.css', css);

      expect(module.exportCode).toContain('globalClass');
    });
  });

  describe('TypeScript generation', () => {
    it('should generate TypeScript definition', async () => {
      const css = `.button { color: blue; }`;
      const module = await processor.process('Button.module.css', css);

      expect(module.typeDefinition).toBeDefined();
      expect(module.typeDefinition).toContain('interface CSSModuleClasses');
      expect(module.typeDefinition).toContain('button');
    });

    it('should include named exports in definition', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          namedExport: true,
        },
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.typeDefinition).toContain('export const button');
    });

    it('should include all classes in interface', async () => {
      const css = `
        .button { color: blue; }
        .icon { size: 16px; }
        .label { font-size: 14px; }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.typeDefinition).toContain('button');
      expect(module.typeDefinition).toContain('icon');
      expect(module.typeDefinition).toContain('label');
    });

    it('should skip TypeScript generation when disabled', async () => {
      const customProcessor = new CSSModulesProcessor({
        typescript: {
          enabled: false,
        },
      });

      const css = `.button { color: blue; }`;
      const module = await customProcessor.process('Button.module.css', css);

      expect(module.typeDefinition).toBeUndefined();
    });
  });

  describe('composition', () => {
    it('should detect composition', async () => {
      const css = `
        .base {
          color: blue;
        }
        .button {
          composes: base;
          padding: 10px;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.compositions.has('button')).toBe(true);
      expect(module.compositions.get('button')).toContain('base');
    });

    it('should handle multiple compositions', async () => {
      const css = `
        .base {
          color: blue;
        }
        .large {
          font-size: 20px;
        }
        .button {
          composes: base large;
          padding: 10px;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      const composed = module.compositions.get('button');
      expect(composed).toContain('base');
      expect(composed).toContain('large');
    });

    it('should remove composes from CSS', async () => {
      const css = `
        .button {
          composes: base;
          padding: 10px;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.processedCSS).not.toContain('composes:');
    });

    it('should support external composition', async () => {
      const css = `
        .button {
          composes: base from './base.module.css';
          padding: 10px;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.compositions.has('button')).toBe(true);
    });

    it('should disable composition when configured', async () => {
      const customProcessor = new CSSModulesProcessor({
        modules: {
          composition: false,
        },
      });

      const css = `
        .button {
          composes: base;
          padding: 10px;
        }
      `;

      const module = await customProcessor.process('Button.module.css', css);

      expect(module.compositions.size).toBe(0);
    });
  });

  describe('processing results', () => {
    it('should generate combined CSS', async () => {
      await processor.process('A.module.css', '.a { color: red; }');
      await processor.process('B.module.css', '.b { color: blue; }');

      const css = processor.generateCSS();

      expect(css).toContain('A.module.css');
      expect(css).toContain('B.module.css');
    });

    it('should calculate statistics', async () => {
      await processor.process('A.module.css', '.a { color: red; }');
      await processor.process('B.module.css', '.b1 { } .b2 { }');

      const stats = processor.getStats();

      expect(stats.totalModules).toBe(2);
      expect(stats.totalClasses).toBe(3);
    });

    it('should track global classes in stats', async () => {
      await processor.process('A.module.css', '.a { } :global(.global) { }');

      const stats = processor.getStats();

      expect(stats.globalClasses).toBe(1);
    });

    it('should track compositions in stats', async () => {
      await processor.process('A.module.css', '.a { } .b { composes: a; }');

      const stats = processor.getStats();

      expect(stats.compositionCount).toBe(1);
    });

    it('should get all modules', async () => {
      await processor.process('A.module.css', '.a { color: red; }');
      await processor.process('B.module.css', '.b { color: blue; }');

      const modules = processor.getModules();

      expect(modules.size).toBe(2);
      expect(modules.has('A.module.css')).toBe(true);
      expect(modules.has('B.module.css')).toBe(true);
    });

    it('should process all and return result', async () => {
      await processor.process('A.module.css', '.a { color: red; }');
      await processor.process('B.module.css', '.b { color: blue; }');

      const result = await processor.processAll();

      expect(result.modules.size).toBe(2);
      expect(result.css).toBeDefined();
      expect(result.stats).toBeDefined();
    });
  });

  describe('utilities', () => {
    it('should clear cached data', async () => {
      await processor.process('A.module.css', '.a { color: red; }');

      expect(processor.getModules().size).toBe(1);

      processor.clear();

      expect(processor.getModules().size).toBe(0);
    });

    it('should get specific module', async () => {
      await processor.process('A.module.css', '.a { color: red; }');

      const module = processor.getModule('A.module.css');

      expect(module).toBeDefined();
      expect(module?.filename).toBe('A.module.css');
    });

    it('should return undefined for non-existent module', () => {
      const module = processor.getModule('NonExistent.module.css');

      expect(module).toBeUndefined();
    });

    it('should create processor with factory function', () => {
      const config: CSSModulesConfig = {
        dev: true,
      };

      const newProcessor = createCSSModulesProcessor(config);

      expect(newProcessor).toBeInstanceOf(CSSModulesProcessor);
    });
  });

  describe('edge cases', () => {
    it('should handle empty CSS', async () => {
      const module = await processor.process('Empty.module.css', '');

      expect(module.locals).toEqual({});
      expect(module.processedCSS).toBe('');
    });

    it('should handle CSS without classes', async () => {
      const css = `
        body {
          margin: 0;
        }
      `;

      const module = await processor.process('Global.module.css', css);

      expect(Object.keys(module.locals)).toHaveLength(0);
    });

    it('should handle class names with numbers', async () => {
      const css = `.button123 { color: blue; }`;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button123');
    });

    it('should handle class names with underscores', async () => {
      const css = `.button_primary { color: blue; }`;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button_primary');
    });

    it('should handle class names with hyphens', async () => {
      const css = `.button-primary { color: blue; }`;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button-primary');
    });

    it('should handle pseudo-classes', async () => {
      const css = `
        .button:hover {
          color: red;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button');
      expect(module.processedCSS).toContain(':hover');
    });

    it('should handle pseudo-elements', async () => {
      const css = `
        .button::before {
          content: "";
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button');
      expect(module.processedCSS).toContain('::before');
    });

    it('should handle nested selectors', async () => {
      const css = `
        .container .button {
          color: blue;
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('container');
      expect(module.locals).toHaveProperty('button');
    });

    it('should handle media queries', async () => {
      const css = `
        .button {
          color: blue;
        }
        @media (max-width: 768px) {
          .button {
            color: red;
          }
        }
      `;

      const module = await processor.process('Button.module.css', css);

      expect(module.locals).toHaveProperty('button');
      expect(module.processedCSS).toContain('@media');
    });
  });

  describe('development mode', () => {
    it('should use readable class names in dev mode', async () => {
      const devProcessor = new CSSModulesProcessor({
        dev: true,
      });

      const css = `.button { color: blue; }`;
      const module = await devProcessor.process('Button.module.css', css);

      expect(module.locals['button']).toContain('button');
    });

    it('should use shorter hashes in dev mode', async () => {
      const devProcessor = new CSSModulesProcessor({
        dev: true,
        modules: {
          hashLength: 5,
        },
      });

      const css = `.button { color: blue; }`;
      const module = await devProcessor.process('Button.module.css', css);

      // Dev mode default pattern includes [local]
      expect(module.locals['button']).toMatch(/button__[a-zA-Z0-9_-]{5}/);
    });
  });
});

describe('CSS Modules Utilities', () => {
  describe('extractClassNames', () => {
    it('should extract class names from CSS', () => {
      const css = `
        .button { color: blue; }
        .icon { size: 16px; }
      `;

      const classNames = extractClassNames(css);

      expect(classNames).toContain('button');
      expect(classNames).toContain('icon');
    });

    it('should deduplicate class names', () => {
      const css = `
        .button { color: blue; }
        .button:hover { color: red; }
      `;

      const classNames = extractClassNames(css);

      expect(classNames.filter((c) => c === 'button')).toHaveLength(1);
    });

    it('should handle empty CSS', () => {
      const classNames = extractClassNames('');

      expect(classNames).toEqual([]);
    });
  });

  describe('hasGlobalClasses', () => {
    it('should detect :global() wrapper', () => {
      const css = ':global(.global-class) { color: red; }';

      expect(hasGlobalClasses(css)).toBe(true);
    });

    it('should detect :global block', () => {
      const css = ':global { .global-class { color: red; } }';

      expect(hasGlobalClasses(css)).toBe(true);
    });

    it('should return false for CSS without globals', () => {
      const css = '.button { color: blue; }';

      expect(hasGlobalClasses(css)).toBe(false);
    });
  });

  describe('hasComposition', () => {
    it('should detect composes keyword', () => {
      const css = '.button { composes: base; }';

      expect(hasComposition(css)).toBe(true);
    });

    it('should return false for CSS without composition', () => {
      const css = '.button { color: blue; }';

      expect(hasComposition(css)).toBe(false);
    });
  });
});
