/**
 * Main Compiler Tests
 *
 * Tests for the complete compilation pipeline including
 * different modes, error handling, and plugin system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  compile,
  compileWithTypeChecking,
  analyzeOnly,
  createPlugin,
  getDefaultOptions,
  validateOptions,
  type CompilerPlugin,
} from '../../src/compiler/index.js';
import { AetherCompiler, createCompiler } from '../../src/compiler/compiler.js';

describe('AetherCompiler', () => {
  describe('Basic Compilation', () => {
    it('should compile simple component', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Hello World</div>;
        });
      `;

      const result = await compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
      expect(result.warnings).toEqual([]);
    });

    it('should compile component with signals', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          return () => <div>{count()}</div>;
        });
      `;

      const result = await compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.code).toContain('signal');
    });

    it('should compile component with effects', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);

          effect(() => {
            console.log('Count:', count());
          });

          return () => <div>{count()}</div>;
        });
      `;

      const result = await compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.code).toContain('effect');
    });

    it('should compile nested components', async () => {
      const code = `
        const Child = () => <span>Child</span>;

        export default defineComponent(() => {
          return () => <div><Child /></div>;
        });
      `;

      const result = await compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.code).toContain('Child');
    });
  });

  describe('Compilation Modes', () => {
    it('should compile in development mode', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Dev Mode</div>;
        });
      `;

      const result = await compile(code, 'test.tsx', {
        mode: 'development',
        optimize: 'none',
      });

      expect(result.code).toBeDefined();
      // Development mode should preserve readability
      expect(result.code.length).toBeGreaterThan(code.length);
    });

    it('should compile in production mode', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          return () => <div>{count()}</div>;
        });
      `;

      const result = await compile(code, 'test.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });

    it('should apply aggressive optimizations', async () => {
      const code = `
        export default defineComponent(() => {
          const staticValue = signal(42);
          return () => <div>{staticValue()}</div>;
        });
      `;

      const result = await compile(code, 'test.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
      // Aggressive mode should optimize away the signal
      // This is tested in more detail in optimizer tests
    });
  });

  describe('Source Maps', () => {
    it('should not generate source map by default', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx');

      expect(result.map).toBeFalsy();
    });

    it('should generate source map when enabled', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        sourcemap: true,
      });

      expect(result.map).toBeDefined();
      expect(result.map?.version).toBe(3);
      expect(result.map?.sources).toContain('test.tsx');
    });

    it('should generate inline source map', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        sourcemap: 'inline',
      });

      expect(result.code).toContain('sourceMappingURL=data:application/json;base64');
    });

    it('should generate hidden source map', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        sourcemap: 'hidden',
      });

      // Hidden means map is generated but not referenced
      expect(result.code).not.toContain('sourceMappingURL');
    });
  });

  describe('Minification', () => {
    it('should minify code when enabled', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          const increment = () => count.set(c => c + 1);

          return () => (
            <div>
              <button onClick={increment}>
                Count: {count()}
              </button>
            </div>
          );
        });
      `;

      const unminified = await compile(code, 'test.tsx', {
        minify: false,
      });

      const minified = await compile(code, 'test.tsx', {
        minify: true,
      });

      expect(minified.code.length).toBeLessThan(unminified.code.length);
      expect(minified.code).not.toContain('  '); // No double spaces
    });
  });

  describe('JSX Configuration', () => {
    it('should use automatic JSX runtime by default', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      // Automatic runtime doesn't require explicit jsx imports
    });

    it('should support classic JSX runtime', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        jsx: {
          runtime: 'classic',
          pragma: 'jsx',
          pragmaFrag: 'Fragment',
        },
      });

      expect(result.code).toBeDefined();
    });

    it('should support custom JSX import source', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        jsx: {
          runtime: 'automatic',
          importSource: '@custom/jsx-runtime',
        },
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Error Handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const code = `export default () => <div>Unclosed div`;

      const result = await compile(code, 'test.tsx');

      // Should return original code on error
      expect(result.code).toBe(code);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]?.level).toBe('error');
    });

    it('should handle invalid JSX', async () => {
      const code = `export default () => <><//>invalid`;

      const result = await compile(code, 'test.tsx');

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should collect warnings', async () => {
      const code = `
        export default defineComponent(() => {
          // @ts-expect-error - intentional error
          const x: number = "string";
          return () => <div>{x}</div>;
        });
      `;

      const result = await compile(code, 'test.tsx');

      expect(result.warnings).toBeDefined();
    });
  });

  describe('Plugin System', () => {
    it('should support pre-transform plugins', async () => {
      const plugin: CompilerPlugin = {
        name: 'test-pre-plugin',
        enforce: 'pre',
        transform(code) {
          return {
            code: code.replace('Hello', 'Goodbye'),
          };
        },
      };

      const code = `export default () => <div>Hello World</div>;`;
      const result = await compile(code, 'test.tsx', {
        plugins: [plugin],
      });

      expect(result.code).toContain('Goodbye');
    });

    it('should support post-transform plugins', async () => {
      const plugin: CompilerPlugin = {
        name: 'test-post-plugin',
        enforce: 'post',
        transform(code) {
          return {
            code: code + '\n// Post-processed',
          };
        },
      };

      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        plugins: [plugin],
      });

      expect(result.code).toContain('Post-processed');
    });

    it('should execute plugins in order', async () => {
      const execOrder: string[] = [];

      const plugin1: CompilerPlugin = {
        name: 'plugin-1',
        enforce: 'pre',
        transform(code) {
          execOrder.push('plugin-1');
          return { code };
        },
      };

      const plugin2: CompilerPlugin = {
        name: 'plugin-2',
        enforce: 'pre',
        transform(code) {
          execOrder.push('plugin-2');
          return { code };
        },
      };

      const code = `export default () => <div>Test</div>;`;
      await compile(code, 'test.tsx', {
        plugins: [plugin1, plugin2],
      });

      expect(execOrder).toEqual(['plugin-1', 'plugin-2']);
    });

    it('should handle plugin errors', async () => {
      const plugin: CompilerPlugin = {
        name: 'error-plugin',
        transform() {
          throw new Error('Plugin error');
        },
      };

      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        plugins: [plugin],
      });

      // Should still return some result
      expect(result.code).toBeDefined();
    });

    it('should support plugin warnings', async () => {
      const plugin: CompilerPlugin = {
        name: 'warning-plugin',
        enforce: 'pre',
        transform(code) {
          return {
            code,
            warnings: [
              {
                message: 'Plugin warning',
                code: 'PLUGIN_WARN',
                level: 'warning',
              },
            ],
          };
        },
      };

      const code = `export default () => <div>Test</div>;`;
      const result = await compile(code, 'test.tsx', {
        plugins: [plugin],
      });

      expect(result.warnings.some((w) => w.message === 'Plugin warning')).toBe(true);
    });
  });

  describe('Type Checking', () => {
    it('should support type checking compilation', async () => {
      const code = `
        export default defineComponent(() => {
          const count: number = 0;
          return () => <div>{count}</div>;
        });
      `;

      const result = await compileWithTypeChecking(code, 'test.tsx');

      expect(result.code).toBeDefined();
    });

    it('should detect type errors', async () => {
      const code = `
        export default defineComponent(() => {
          const count: number = "not a number";
          return () => <div>{count}</div>;
        });
      `;

      const result = await compileWithTypeChecking(code, 'test.tsx');

      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });

  describe('Analysis Only', () => {
    it('should analyze without compiling', () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          effect(() => console.log(count()));
          return () => <div>{count()}</div>;
        });
      `;

      const analysis = analyzeOnly(code, 'test.tsx');

      expect(analysis.signals.length).toBeGreaterThan(0);
      expect(analysis.effects.length).toBeGreaterThan(0);
      expect(analysis.components.length).toBeGreaterThan(0);
    });

    it('should detect optimization opportunities', () => {
      const code = `
        export default defineComponent(() => {
          const staticValue = signal(42);
          return () => <div>{staticValue()}</div>;
        });
      `;

      const analysis = analyzeOnly(code, 'test.tsx', {
        optimize: 'aggressive',
      });

      expect(analysis.optimizations.length).toBeGreaterThan(0);
    });
  });

  describe('Options Validation', () => {
    it('should provide default options for development', () => {
      const options = getDefaultOptions('development');

      expect(options.mode).toBe('development');
      expect(options.optimize).toBe('none');
      expect(options.sourcemap).toBe(true);
      expect(options.minify).toBe(false);
    });

    it('should provide default options for production', () => {
      const options = getDefaultOptions('production');

      expect(options.mode).toBe('production');
      expect(options.optimize).toBe('aggressive');
      expect(options.sourcemap).toBe(false);
      expect(options.minify).toBe(true);
    });

    it('should validate and normalize options', () => {
      const options = validateOptions({
        mode: 'development',
      });

      expect(options.jsx).toBeDefined();
      expect(options.jsx?.runtime).toBe('automatic');
      expect(options.plugins).toEqual([]);
    });

    it('should warn for incompatible option combinations', () => {
      const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => { });

      validateOptions({
        mode: 'development',
        optimize: 'aggressive',
      });

      expect(consoleWarn).toHaveBeenCalled();
      consoleWarn.mockRestore();
    });
  });

  describe('AetherCompiler Class', () => {
    let compiler: AetherCompiler;

    beforeEach(() => {
      compiler = createCompiler({
        mode: 'production',
        optimize: 'basic',
      });
    });

    it('should create compiler instance', () => {
      expect(compiler).toBeDefined();
    });

    it('should compile with instance', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compiler.compile(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.metrics).toBeDefined();
    });

    it('should track compilation metrics', async () => {
      const code = `export default () => <div>Test</div>;`;
      const result = await compiler.compile(code, 'test.tsx');

      expect(result.metrics?.parseTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.analysisTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.transformTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.totalTime).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.originalSize).toBe(code.length);
      expect(result.metrics?.compiledSize).toBeGreaterThan(0);
    });

    it('should compile multiple files', async () => {
      const files = [
        { code: `export default () => <div>File1</div>;`, path: 'file1.tsx' },
        { code: `export default () => <div>File2</div>;`, path: 'file2.tsx' },
      ];

      const results = await compiler.compileMany(files);

      expect(results.size).toBe(2);
      expect(results.get('file1.tsx')).toBeDefined();
      expect(results.get('file2.tsx')).toBeDefined();
    });

    it('should allow updating options', () => {
      compiler.setOptions({ minify: true });
      const options = compiler.getOptions();

      expect(options.minify).toBe(true);
    });

    it('should calculate size reduction', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Test Component</div>;
        });
      `;

      const result = await compiler.compile(code, 'test.tsx');

      expect(result.metrics?.sizeReduction).toBeGreaterThanOrEqual(0);
      expect(result.metrics?.sizeReductionPercent).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Create Plugin Helper', () => {
    it('should create plugin with helper', () => {
      const plugin = createPlugin({
        name: 'my-plugin',
        transform(code) {
          return { code: code + '\n// Modified' };
        },
      });

      expect(plugin.name).toBe('my-plugin');
      expect(plugin.transform).toBeDefined();
    });

    it('should support all plugin hooks', () => {
      const plugin = createPlugin({
        name: 'full-plugin',
        enforce: 'pre',
        transform(code) {
          return { code };
        },
        resolveId(id) {
          return id;
        },
        load(id) {
          return 'loaded content';
        },
      });

      expect(plugin.enforce).toBe('pre');
      expect(plugin.transform).toBeDefined();
      expect(plugin.resolveId).toBeDefined();
      expect(plugin.load).toBeDefined();
    });
  });

  describe('Islands and Server Components', () => {
    it('should support islands option', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Island Component</div>;
        });
      `;

      const result = await compile(code, 'test.tsx', {
        islands: true,
      });

      expect(result.code).toBeDefined();
    });

    it('should support server components option', async () => {
      const code = `
        'use server';
        export default defineComponent(() => {
          return () => <div>Server Component</div>;
        });
      `;

      const result = await compile(code, 'test.tsx', {
        serverComponents: true,
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Performance', () => {
    it('should compile quickly', async () => {
      const code = `export default () => <div>Test</div>;`;
      const start = Date.now();

      await compile(code, 'test.tsx');

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('should handle large files', async () => {
      // Generate a large component
      const components = Array.from({ length: 100 }, (_, i) => `const Component${i} = () => <div>Component ${i}</div>;`).join('\n');

      const code = `
        ${components}
        export default () => (
          <div>
            ${Array.from({ length: 100 }, (_, i) => `<Component${i} />`).join('\n')}
          </div>
        );
      `;

      const result = await compile(code, 'large.tsx');

      expect(result.code).toBeDefined();
      expect(result.metrics?.totalTime).toBeLessThan(5000);
    });
  });
});
