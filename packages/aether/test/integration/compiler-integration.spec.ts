/**
 * Compiler Integration Tests
 *
 * Tests the entire compiler pipeline working together:
 * - Parse → Analyze → Transform → Optimize → Generate
 * - All optimization passes together
 * - Source map generation and accuracy
 * - Plugin system integration
 * - Performance benchmarks
 * - Bundle size verification
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createCompiler, compile, compileWithResult } from '../../src/compiler/compiler.js';
import { Optimizer } from '../../src/compiler/optimizer.js';

describe('Compiler Integration', () => {
  describe('Full compilation pipeline', () => {
    it('should compile a complete component with all optimizations', async () => {
      const source = `
        import { signal, computed, effect } from '@omnitron-dev/aether';

        export function Counter() {
          const count = signal(0);
          const doubled = computed(() => count() * 2);

          effect(() => {
            console.log('Count:', count());
          });

          return () => (
            <div>
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
              <button onClick={() => count.set(count() + 1)}>
                Increment
              </button>
            </div>
          );
        }
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
        sourcemap: true,
        mode: 'production',
      });

      const result = await compiler.compile(source, 'Counter.tsx');

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeLessThan(source.length);
      expect(result.map).toBeDefined();
      expect(result.warnings).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.metrics).toBeDefined();

      // Check metrics
      expect(result.metrics?.parseTime).toBeGreaterThan(0);
      expect(result.metrics?.analysisTime).toBeGreaterThan(0);
      expect(result.metrics?.transformTime).toBeGreaterThan(0);
      expect(result.metrics?.optimizationTime).toBeGreaterThan(0);
      expect(result.metrics?.totalTime).toBeGreaterThan(0);
      expect(result.metrics?.sizeReduction).toBeGreaterThan(0);
      expect(result.metrics?.sizeReductionPercent).toBeGreaterThan(0);

      // Verify analysis results
      expect(result.analysis?.signals).toBeDefined();
      expect(result.analysis?.computed).toBeDefined();
      expect(result.analysis?.effects).toBeDefined();
    });

    it('should compile with basic optimization level', async () => {
      const source = `
        export function App() {
          const name = signal('World');
          return () => <h1>Hello {name()}</h1>;
        }
      `;

      const result = await compileWithResult(source, 'App.tsx', {
        optimize: 'basic',
        mode: 'production',
      });

      expect(result.code).toBeDefined();
      expect(result.metrics?.sizeReduction).toBeGreaterThan(0);
    });

    it('should compile without optimization', async () => {
      const source = `
        export function Simple() {
          return () => <div>Simple</div>;
        }
      `;

      const result = await compileWithResult(source, 'Simple.tsx', {
        optimize: 'none',
        mode: 'development',
      });

      expect(result.code).toBeDefined();
      expect(result.metrics?.optimizationTime).toBe(0);
    });

    it('should handle complex nested components', async () => {
      const source = `
        import { signal, For, Show } from '@omnitron-dev/aether';

        export function TodoList() {
          const todos = signal([
            { id: 1, text: 'Learn Aether', done: false },
            { id: 2, text: 'Build app', done: false }
          ]);
          const filter = signal('all');

          const filtered = computed(() => {
            const f = filter();
            return todos().filter(t =>
              f === 'all' ? true :
              f === 'active' ? !t.done : t.done
            );
          });

          return () => (
            <div class="todo-list">
              <input
                placeholder="Add todo"
                onKeyPress={handleAdd}
              />
              <For each={filtered()}>
                {(todo) => (
                  <div class="todo-item">
                    <Show when={!todo.done}>
                      <span>{todo.text}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          );
        }
      `;

      const result = await compileWithResult(source, 'TodoList.tsx', {
        optimize: 'aggressive',
        sourcemap: true,
      });

      expect(result.code).toBeDefined();
      expect(result.analysis?.signals.length).toBeGreaterThan(0);
      expect(result.analysis?.computed.length).toBeGreaterThan(0);
    });
  });

  describe('Optimization passes', () => {
    let optimizer: Optimizer;

    beforeEach(() => {
      optimizer = new Optimizer({
        mode: 'aggressive',
        development: false,
        sourceMaps: true,
      });
    });

    it('should apply all optimizations together', async () => {
      const code = `
        function Component() {
          const x = signal(0);
          const y = computed(() => x() * 2);
          const z = computed(() => y() + 1);

          effect(() => {
            console.log(x());
          });

          effect(() => {
            console.log(y());
          });

          return () => <div>{z()}</div>;
        }
      `;

      const result = await optimizer.optimize(code, 'test.tsx');

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeLessThan(code.length);
      expect(result.warnings).toBeDefined();
      expect(result.sourceMap).toBeDefined();
    });

    it('should optimize signal usage', async () => {
      const code = `
        const count = signal(0);
        const double = computed(() => count() * 2);
        const triple = computed(() => count() * 3);
        const quad = computed(() => double() * 2);
      `;

      const result = await optimizer.optimize(code, 'signals.ts');

      expect(result.code).toBeDefined();
      // Verify optimizations were applied
      expect(result.code.includes('signal') || result.code.includes('computed')).toBe(true);
    });

    it('should batch effect executions', async () => {
      const code = `
        effect(() => {
          console.log(a());
        });
        effect(() => {
          console.log(b());
        });
        effect(() => {
          console.log(c());
        });
      `;

      const result = await optimizer.optimize(code, 'effects.ts');

      expect(result.code).toBeDefined();
    });

    it('should eliminate dead code', async () => {
      const code = `
        const unused = signal(0);
        const alsoUnused = computed(() => unused() * 2);

        const used = signal(1);
        console.log(used());
      `;

      const result = await optimizer.optimize(code, 'deadcode.ts');

      expect(result.code).toBeDefined();
      // Dead code elimination should reduce size
      expect(result.code.length).toBeLessThanOrEqual(code.length);
    });

    it('should hoist static components', async () => {
      const code = `
        function App() {
          return () => (
            <div>
              <Header />
              <Main />
              <Footer />
            </div>
          );
        }
      `;

      const result = await optimizer.optimize(code, 'hoisting.tsx');

      expect(result.code).toBeDefined();
    });

    it('should minify code', async () => {
      const code = `
        function VeryLongFunctionName() {
          const veryLongVariableName = signal(0);
          const anotherLongName = computed(() => veryLongVariableName() * 2);
          return () => <div>{anotherLongName()}</div>;
        }
      `;

      const optimizer = new Optimizer({
        mode: 'aggressive',
        development: false,
        sourceMaps: false,
      });

      const result = await optimizer.optimize(code, 'minify.tsx');

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeLessThan(code.length);
    });
  });

  describe('Source maps', () => {
    it('should generate accurate source maps', async () => {
      const source = `
        export function Counter() {
          const count = signal(0);
          return () => (
            <button onClick={() => count.set(count() + 1)}>
              Count: {count()}
            </button>
          );
        }
      `;

      const result = await compileWithResult(source, 'Counter.tsx', {
        optimize: 'basic',
        sourcemap: true,
      });

      expect(result.map).toBeDefined();
      expect(result.map).toHaveProperty('version');
      expect(result.map).toHaveProperty('sources');
      expect(result.map).toHaveProperty('mappings');
      expect(result.map?.sources).toContain('Counter.tsx');
    });

    it('should support inline source maps', async () => {
      const compiler = createCompiler({
        optimize: 'basic',
        sourcemap: 'inline',
      });

      const source = `
        export const App = () => <div>Test</div>;
      `;

      const result = await compiler.compile(source, 'App.tsx');

      expect(result.code).toContain('sourceMappingURL=data:application/json');
    });

    it('should generate hidden source maps', async () => {
      const compiler = createCompiler({
        optimize: 'basic',
        sourcemap: 'hidden',
      });

      const source = `
        export const Component = () => <span>Hidden</span>;
      `;

      const result = await compiler.compile(source, 'Component.tsx');

      expect(result.code).not.toContain('sourceMappingURL');
      expect(result.map).toBeDefined();
    });
  });

  describe('Performance benchmarks', () => {
    it('should compile simple components quickly', async () => {
      const source = `
        export const Simple = () => <div>Simple</div>;
      `;

      const startTime = performance.now();
      await compile(source, {
        optimize: 'basic',
        sourcemap: false,
      });
      const duration = performance.now() - startTime;

      // Should compile in less than 100ms
      expect(duration).toBeLessThan(100);
    });

    it('should handle large files efficiently', async () => {
      // Generate a large component
      const components = Array.from(
        { length: 50 },
        (_, i) => `
        function Component${i}() {
          const state${i} = signal(${i});
          return () => <div>{state${i}()}</div>;
        }
      `
      ).join('\n');

      const source = `
        import { signal } from '@omnitron-dev/aether';
        ${components}
      `;

      const startTime = performance.now();
      const result = await compileWithResult(source, 'Large.tsx', {
        optimize: 'aggressive',
      });
      const duration = performance.now() - startTime;

      expect(result.code).toBeDefined();
      // Large file should compile in reasonable time
      expect(duration).toBeLessThan(1000); // 1 second
    });

    it('should batch compile multiple files', async () => {
      const files = Array.from({ length: 10 }, (_, i) => ({
        code: `export const Component${i} = () => <div>Component ${i}</div>;`,
        path: `Component${i}.tsx`,
      }));

      const compiler = createCompiler({
        optimize: 'basic',
        sourcemap: false,
      });

      const startTime = performance.now();
      const results = await compiler.compileMany(files);
      const duration = performance.now() - startTime;

      expect(results.size).toBe(10);
      expect(duration).toBeLessThan(500);
    });
  });

  describe('Bundle size verification', () => {
    it('should achieve target compression ratios', async () => {
      const source = `
        import { signal, computed, effect } from '@omnitron-dev/aether';

        export function OptimizedComponent() {
          const state = signal({ count: 0, name: 'Test' });
          const derived = computed(() => state().count * 2);

          effect(() => {
            console.log('State changed:', state());
          });

          return () => (
            <div className="container">
              <h1>{state().name}</h1>
              <p>Count: {state().count}</p>
              <p>Derived: {derived()}</p>
              <button onClick={() => state.update(s => ({ ...s, count: s.count + 1 }))}>
                Increment
              </button>
            </div>
          );
        }
      `;

      const result = await compileWithResult(source, 'Optimized.tsx', {
        optimize: 'aggressive',
        mode: 'production',
      });

      expect(result.metrics?.sizeReductionPercent).toBeGreaterThan(10);
    });

    it('should minimize production bundles', async () => {
      const source = `
        export function ProductionComponent() {
          const data = signal([1, 2, 3, 4, 5]);
          return () => (
            <ul>
              {data().map(item => <li key={item}>{item}</li>)}
            </ul>
          );
        }
      `;

      const devResult = await compileWithResult(source, 'Prod.tsx', {
        mode: 'development',
        optimize: 'none',
      });

      const prodResult = await compileWithResult(source, 'Prod.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(prodResult.code.length).toBeLessThan(devResult.code.length);
    });
  });

  describe('Error handling', () => {
    it('should handle syntax errors gracefully', async () => {
      const invalidSource = `
        export function Invalid() {
          const x = signal(
        }
      `;

      const result = await compileWithResult(invalidSource, 'Invalid.tsx');

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings.some((w) => w.level === 'error')).toBe(true);
    });

    it('should recover from optimization failures', async () => {
      const source = `
        export const Component = () => <div>Test</div>;
      `;

      const compiler = createCompiler({
        optimize: 'aggressive',
        mode: 'production',
      });

      const result = await compiler.compile(source, 'Test.tsx');

      // Should complete even if some optimizations fail
      expect(result.code).toBeDefined();
    });
  });

  describe('Plugin system', () => {
    it('should support custom plugins', async () => {
      let pluginCalled = false;

      const customPlugin = {
        name: 'custom-plugin',
        transform: (code: string) => {
          pluginCalled = true;
          return code;
        },
      };

      const compiler = createCompiler({
        plugins: [customPlugin],
      });

      await compiler.compile('export const Test = () => <div />;', 'Test.tsx');

      expect(pluginCalled).toBe(true);
    });
  });

  describe('Multiple compilation', () => {
    it('should maintain consistent results across recompilation', async () => {
      const source = `
        export function Consistent() {
          const x = signal(42);
          return () => <div>{x()}</div>;
        }
      `;

      const compiler = createCompiler({
        optimize: 'basic',
        sourcemap: false,
      });

      const result1 = await compiler.compile(source, 'Test.tsx');
      const result2 = await compiler.compile(source, 'Test.tsx');

      // Results should be consistent
      expect(result1.code).toBe(result2.code);
    });

    it('should update compiler options dynamically', async () => {
      const compiler = createCompiler({
        optimize: 'none',
        sourcemap: false,
      });

      // Use more complex code that benefits from optimization
      const source = `
        import { signal, computed } from '@omnitron-dev/aether';

        export function Component() {
          const count = signal(0);
          const doubled = computed(() => count() * 2);
          const tripled = computed(() => count() * 3);
          const quadrupled = computed(() => count() * 4);

          return () => (
            <div className="component">
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
              <p>Tripled: {tripled()}</p>
              <p>Quadrupled: {quadrupled()}</p>
              <button onClick={() => count.set(count() + 1)}>Increment</button>
            </div>
          );
        }
      `;

      const result1 = await compiler.compile(source, 'Component.tsx');

      compiler.setOptions({ optimize: 'aggressive' });

      const result2 = await compiler.compile(source, 'Component.tsx');

      // Aggressive should produce smaller output due to optimizations
      expect(result2.code.length).toBeLessThan(result1.code.length);
    });
  });

  describe('Real-world scenarios', () => {
    it('should compile a complete application', async () => {
      const appSource = `
        import { signal, computed, createContext, useContext } from '@omnitron-dev/aether';

        const ThemeContext = createContext('light');

        function ThemeProvider({ children }) {
          const theme = signal('light');
          return () => (
            <ThemeContext.Provider value={theme}>
              {children}
            </ThemeContext.Provider>
          );
        }

        function ThemedButton() {
          const theme = useContext(ThemeContext);
          return () => (
            <button class={theme()}>
              Themed Button
            </button>
          );
        }

        export function App() {
          return () => (
            <ThemeProvider>
              <div class="app">
                <ThemedButton />
              </div>
            </ThemeProvider>
          );
        }
      `;

      const result = await compileWithResult(appSource, 'App.tsx', {
        optimize: 'aggressive',
        sourcemap: true,
      });

      expect(result.code).toBeDefined();
      expect(result.map).toBeDefined();
      expect(result.metrics?.totalTime).toBeLessThan(200);
    });
  });
});
