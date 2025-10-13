/**
 * Integration Tests
 *
 * End-to-end tests for the complete compilation pipeline
 * including real-world component scenarios and performance validation
 */

import { describe, it, expect } from 'vitest';
import { compile } from '../../src/compiler/index.js';
import { AetherCompiler } from '../../src/compiler/compiler.js';

describe('Compiler Integration', () => {
  describe('Simple Components', () => {
    it('should compile static component', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Hello World</div>;
        });
      `;

      const result = await compile(code, 'simple.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
      expect(result.warnings.length).toBe(0);
    });

    it('should compile component with props', async () => {
      const code = `
        interface Props {
          name: string;
          age: number;
        }

        export default defineComponent((props: Props) => {
          return () => (
            <div>
              <h1>{props.name}</h1>
              <p>Age: {props.age}</p>
            </div>
          );
        });
      `;

      const result = await compile(code, 'props.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
      expect(result.code).toContain('props');
    });
  });

  describe('Reactive Components', () => {
    it('should compile component with signals', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          const increment = () => count.set(c => c + 1);

          return () => (
            <div>
              <p>Count: {count()}</p>
              <button onClick={increment}>Increment</button>
            </div>
          );
        });
      `;

      const result = await compile(code, 'counter.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
      expect(result.code.length).toBeGreaterThan(0);
    });

    it('should compile component with computed values', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          const doubled = computed(() => count() * 2);
          const tripled = computed(() => count() * 3);

          return () => (
            <div>
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
              <p>Tripled: {tripled()}</p>
            </div>
          );
        });
      `;

      const result = await compile(code, 'computed.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
    });

    it('should compile component with effects', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);

          effect(() => {
            console.log('Count changed:', count());
          });

          effect(() => {
            document.title = \`Count: \${count()}\`;
          });

          return () => (
            <div>
              <p>{count()}</p>
              <button onClick={() => count.set(c => c + 1)}>+</button>
            </div>
          );
        });
      `;

      const result = await compile(code, 'effects.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toContain('effect');
    });
  });

  describe('Complex Components', () => {
    it('should compile nested component structure', async () => {
      const code = `
        const Header = () => <header><h1>Title</h1></header>;
        const Footer = () => <footer><p>Footer</p></footer>;

        export default defineComponent(() => {
          const content = signal("Main content");

          return () => (
            <div>
              <Header />
              <main>{content()}</main>
              <Footer />
            </div>
          );
        });
      `;

      const result = await compile(code, 'nested.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
      expect(result.code).toContain('Header');
      expect(result.code).toContain('Footer');
    });

    it('should compile component with conditional rendering', async () => {
      const code = `
        export default defineComponent(() => {
          const show = signal(true);

          return () => (
            <div>
              {show() && <p>Visible content</p>}
              <button onClick={() => show.set(!show())}>Toggle</button>
            </div>
          );
        });
      `;

      const result = await compile(code, 'conditional.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });

    it('should compile component with list rendering', async () => {
      const code = `
        export default defineComponent(() => {
          const items = signal(['A', 'B', 'C']);

          return () => (
            <ul>
              {items().map(item => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          );
        });
      `;

      const result = await compile(code, 'list.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toContain('map');
    });

    it('should compile component with forms', async () => {
      const code = `
        export default defineComponent(() => {
          const name = signal('');
          const email = signal('');

          const handleSubmit = (e: Event) => {
            e.preventDefault();
            console.log('Submit:', name(), email());
          };

          return () => (
            <form onSubmit={handleSubmit}>
              <input
                type="text"
                value={name()}
                onInput={(e) => name.set(e.target.value)}
              />
              <input
                type="email"
                value={email()}
                onInput={(e) => email.set(e.target.value)}
              />
              <button type="submit">Submit</button>
            </form>
          );
        });
      `;

      const result = await compile(code, 'form.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Performance Optimizations', () => {
    it('should achieve size reduction with optimizations', async () => {
      const code = `
        export default defineComponent(() => {
          const staticValue = signal(42);
          const unused = signal(999);
          const count = signal(0);

          effect(() => {
            console.log('Count:', count());
          });

          return () => (
            <div>
              <p>Static: {staticValue()}</p>
              <p>Count: {count()}</p>
            </div>
          );
        });
      `;

      const compiler = new AetherCompiler({
        mode: 'production',
        optimize: 'aggressive',
        minify: true,
        collectMetrics: true,
      });

      const unoptimized = await compile(code, 'test.tsx', {
        mode: 'production',
        optimize: 'none',
        minify: false,
      });

      const optimized = await compiler.compile(code, 'test.tsx');

      expect(optimized.metrics?.sizeReduction).toBeGreaterThan(0);
      expect(optimized.code.length).toBeLessThan(unoptimized.code.length);
    });

    it('should inline constant signals', async () => {
      const code = `
        const CONSTANT = signal(42);
        console.log(CONSTANT());
      `;

      const result = await compile(code, 'constant.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toContain('42');
    });

    it('should remove unused code', async () => {
      const code = `
        import { unused } from 'lib';
        const unusedVar = 999;
        const used = 42;
        console.log(used);
      `;

      const result = await compile(code, 'unused.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).not.toContain('unused');
    });

    it('should batch effects', async () => {
      const code = `
        const a = signal(1);
        const b = signal(2);
        effect(() => console.log(a()));
        effect(() => console.log(b()));
      `;

      const result = await compile(code, 'batch.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Real-World Scenarios', () => {
    it('should compile todo app component', async () => {
      const code = `
        interface Todo {
          id: number;
          text: string;
          done: boolean;
        }

        export default defineComponent(() => {
          const todos = signal<Todo[]>([]);
          const input = signal('');

          const addTodo = () => {
            if (input().trim()) {
              todos.set([
                ...todos(),
                { id: Date.now(), text: input(), done: false }
              ]);
              input.set('');
            }
          };

          const toggleTodo = (id: number) => {
            todos.set(
              todos().map(t => t.id === id ? { ...t, done: !t.done } : t)
            );
          };

          const removeTodo = (id: number) => {
            todos.set(todos().filter(t => t.id !== id));
          };

          return () => (
            <div>
              <h1>Todo List</h1>
              <div>
                <input
                  value={input()}
                  onInput={(e) => input.set(e.target.value)}
                  onKeyPress={(e) => e.key === 'Enter' && addTodo()}
                />
                <button onClick={addTodo}>Add</button>
              </div>
              <ul>
                {todos().map(todo => (
                  <li key={todo.id}>
                    <input
                      type="checkbox"
                      checked={todo.done}
                      onChange={() => toggleTodo(todo.id)}
                    />
                    <span style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>
                      {todo.text}
                    </span>
                    <button onClick={() => removeTodo(todo.id)}>Delete</button>
                  </li>
                ))}
              </ul>
            </div>
          );
        });
      `;

      const result = await compile(code, 'todo-app.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
      expect(result.warnings.length).toBe(0);
    });

    it('should compile dashboard with multiple features', async () => {
      const code = `
        export default defineComponent(() => {
          const user = signal({ name: 'John', role: 'Admin' });
          const stats = signal({ views: 0, clicks: 0 });
          const loading = signal(false);

          effect(() => {
            // Simulate data fetching
            if (!loading()) {
              console.log('Stats:', stats());
            }
          });

          const refresh = async () => {
            loading.set(true);
            // Simulate API call
            await new Promise(r => setTimeout(r, 1000));
            stats.set({ views: Math.random() * 1000, clicks: Math.random() * 100 });
            loading.set(false);
          };

          return () => (
            <div>
              <header>
                <h1>Dashboard</h1>
                <p>Welcome, {user().name} ({user().role})</p>
              </header>
              <main>
                {loading() ? (
                  <p>Loading...</p>
                ) : (
                  <div>
                    <div>Views: {stats().views}</div>
                    <div>Clicks: {stats().clicks}</div>
                  </div>
                )}
                <button onClick={refresh}>Refresh</button>
              </main>
            </div>
          );
        });
      `;

      const result = await compile(code, 'dashboard.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });

    it('should compile data table component', async () => {
      const code = `
        interface Row {
          id: number;
          name: string;
          value: number;
        }

        export default defineComponent(() => {
          const data = signal<Row[]>([
            { id: 1, name: 'Item 1', value: 100 },
            { id: 2, name: 'Item 2', value: 200 },
          ]);

          const sortBy = signal<keyof Row>('id');
          const sortDir = signal<'asc' | 'desc'>('asc');

          const sorted = computed(() => {
            const sorted = [...data()];
            sorted.sort((a, b) => {
              const aVal = a[sortBy()];
              const bVal = b[sortBy()];
              const multiplier = sortDir() === 'asc' ? 1 : -1;
              return aVal < bVal ? -multiplier : multiplier;
            });
            return sorted;
          });

          return () => (
            <table>
              <thead>
                <tr>
                  <th onClick={() => sortBy.set('id')}>ID</th>
                  <th onClick={() => sortBy.set('name')}>Name</th>
                  <th onClick={() => sortBy.set('value')}>Value</th>
                </tr>
              </thead>
              <tbody>
                {sorted().map(row => (
                  <tr key={row.id}>
                    <td>{row.id}</td>
                    <td>{row.name}</td>
                    <td>{row.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        });
      `;

      const result = await compile(code, 'data-table.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Error Recovery', () => {
    it('should handle syntax errors gracefully', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Unclosed
        });
      `;

      const result = await compile(code, 'error.tsx', {
        mode: 'production',
        optimize: 'basic',
      });

      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.code).toBeDefined();
    });

    it('should recover from transformation errors', async () => {
      const code = `
        export default defineComponent(() => {
          const invalid = signal();
          return () => <div>{invalid()}</div>;
        });
      `;

      const result = await compile(code, 'transform-error.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Compilation Speed', () => {
    it('should compile quickly', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          return () => <div>{count()}</div>;
        });
      `;

      const start = Date.now();
      await compile(code, 'speed.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000); // Should be fast
    });

    it('should handle large components efficiently', async () => {
      // Generate large component with many signals
      const signals = Array.from(
        { length: 50 },
        (_, i) => `const signal${i} = signal(${i});`
      ).join('\n');

      const accesses = Array.from({ length: 50 }, (_, i) => `<p>{signal${i}()}</p>`).join('\n');

      const code = `
        export default defineComponent(() => {
          ${signals}

          return () => (
            <div>
              ${accesses}
            </div>
          );
        });
      `;

      const compiler = new AetherCompiler({
        mode: 'production',
        optimize: 'aggressive',
        collectMetrics: true,
      });

      const result = await compiler.compile(code, 'large.tsx');

      expect(result.metrics?.totalTime).toBeLessThan(5000);
      expect(result.code).toBeDefined();
    });
  });

  describe('Bundle Size', () => {
    it('should meet size reduction targets', async () => {
      const code = `
        export default defineComponent(() => {
          const staticValue = signal(42);
          const unusedValue = signal(999);
          const count = signal(0);

          if (false) {
            console.log('Dead code');
          }

          return () => (
            <div>
              <p>Static: {staticValue()}</p>
              <p>Count: {count()}</p>
            </div>
          );
        });
      `;

      const compiler = new AetherCompiler({
        mode: 'production',
        optimize: 'aggressive',
        minify: true,
        collectMetrics: true,
      });

      const result = await compiler.compile(code, 'bundle.tsx');
      const metrics = compiler.getMetrics();

      // Target: >30% size reduction
      expect(metrics?.sizeReductionPercent).toBeGreaterThan(30);
    });
  });

  describe('Source Maps', () => {
    it('should generate source maps in development', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Hello</div>;
        });
      `;

      const result = await compile(code, 'sourcemap.tsx', {
        mode: 'development',
        sourcemap: true,
      });

      expect(result.map).toBeDefined();
      expect(result.map?.version).toBe(3);
    });

    it('should support inline source maps', async () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Hello</div>;
        });
      `;

      const result = await compile(code, 'inline-map.tsx', {
        mode: 'development',
        sourcemap: 'inline',
      });

      expect(result.code).toContain('sourceMappingURL=data:application/json;base64');
    });
  });

  describe('Islands and Server Components', () => {
    it('should compile island component', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);

          return () => (
            <button onClick={() => count.set(c => c + 1)}>
              Count: {count()}
            </button>
          );
        });
      `;

      const result = await compile(code, 'island.tsx', {
        mode: 'production',
        islands: true,
        optimize: 'aggressive',
      });

      expect(result.code).toBeDefined();
    });

    it('should compile server component', async () => {
      const code = `
        'use server';
        export default defineComponent(() => {
          return () => <div>Server-rendered content</div>;
        });
      `;

      const result = await compile(code, 'server.tsx', {
        mode: 'production',
        serverComponents: true,
        optimize: 'basic',
      });

      expect(result.code).toBeDefined();
    });
  });

  describe('Development vs Production', () => {
    it('should preserve readability in development', async () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          return () => <div>{count()}</div>;
        });
      `;

      const devResult = await compile(code, 'dev.tsx', {
        mode: 'development',
        optimize: 'none',
        minify: false,
      });

      const prodResult = await compile(code, 'prod.tsx', {
        mode: 'production',
        optimize: 'aggressive',
        minify: true,
      });

      expect(devResult.code.length).toBeGreaterThan(prodResult.code.length);
    });

    it('should optimize aggressively in production', async () => {
      const code = `
        const unused = signal(999);
        export default defineComponent(() => {
          const count = signal(0);
          return () => <div>{count()}</div>;
        });
      `;

      const result = await compile(code, 'prod-opt.tsx', {
        mode: 'production',
        optimize: 'aggressive',
      });

      expect(result.code).not.toContain('unused');
    });
  });
});
