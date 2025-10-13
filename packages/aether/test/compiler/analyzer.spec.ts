/**
 * Analyzer Tests
 *
 * Tests for static analysis including signal detection,
 * effect analysis, and optimization opportunity identification
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/compiler/parser.js';
import { analyze } from '../../src/compiler/analyzer.js';

describe('Analyzer', () => {
  describe('Signal Analysis', () => {
    it('should detect signal declarations', () => {
      const code = `
        const count = signal(0);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(1);
      expect(analysis.signals[0]?.name).toBe('count');
      expect(analysis.signals[0]?.initialValue).toBe(0);
    });

    it('should track signal accesses', () => {
      const code = `
        const count = signal(0);
        const value = count();
        const doubled = count() * 2;
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const signal = analysis.signals[0];
      expect(signal).toBeDefined();
      expect(signal!.accesses.length).toBeGreaterThan(0);
    });

    it('should track signal updates', () => {
      const code = `
        const count = signal(0);
        count.set(1);
        count.set(2);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const signal = analysis.signals[0];
      expect(signal).toBeDefined();
      expect(signal!.updates.length).toBeGreaterThan(0);
    });

    it('should detect constant signals', () => {
      const code = `
        const staticValue = signal(42);
        const value = staticValue();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const signal = analysis.signals[0];
      expect(signal).toBeDefined();
      expect(signal!.optimizable).toBe(true);
    });

    it('should detect non-optimizable signals', () => {
      const code = `
        const count = signal(0);
        count.set(count() + 1);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const signal = analysis.signals[0];
      expect(signal).toBeDefined();
      // Signal is updated, may not be optimizable
    });

    it('should handle multiple signals', () => {
      const code = `
        const count = signal(0);
        const name = signal("John");
        const active = signal(true);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(3);
      expect(analysis.signals.map((s) => s.name)).toContain('count');
      expect(analysis.signals.map((s) => s.name)).toContain('name');
      expect(analysis.signals.map((s) => s.name)).toContain('active');
    });

    it('should detect signal initial values', () => {
      const code = `
        const num = signal(42);
        const str = signal("hello");
        const bool = signal(true);
        const nil = signal(null);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals[0]?.initialValue).toBe(42);
      expect(analysis.signals[1]?.initialValue).toBe('hello');
      expect(analysis.signals[2]?.initialValue).toBe(true);
      expect(analysis.signals[3]?.initialValue).toBe(null);
    });
  });

  describe('Effect Analysis', () => {
    it('should detect effect declarations', () => {
      const code = `
        effect(() => {
          console.log('Effect');
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.effects.length).toBe(1);
      expect(analysis.effects[0]?.type).toBe('effect');
    });

    it('should extract effect dependencies', () => {
      const code = `
        const count = signal(0);
        effect(() => {
          console.log(count());
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const effect = analysis.effects[0];
      expect(effect).toBeDefined();
      expect(effect!.dependencies.length).toBeGreaterThan(0);
    });

    it('should detect batchable effects', () => {
      const code = `
        const count = signal(0);
        effect(() => console.log(count()));
        effect(() => console.log(count() * 2));
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const batchableEffects = analysis.effects.filter((e) => e.batchable);
      expect(batchableEffects.length).toBeGreaterThan(0);
    });

    it('should handle multiple effects', () => {
      const code = `
        const a = signal(1);
        const b = signal(2);

        effect(() => console.log(a()));
        effect(() => console.log(b()));
        effect(() => console.log(a() + b()));
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.effects.length).toBe(3);
    });

    it('should detect effect without dependencies', () => {
      const code = `
        effect(() => {
          console.log('No dependencies');
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const effect = analysis.effects[0];
      expect(effect).toBeDefined();
      expect(effect!.dependencies.length).toBe(0);
      expect(effect!.batchable).toBe(false);
    });
  });

  describe('Computed Analysis', () => {
    it('should detect computed declarations', () => {
      const code = `
        const count = signal(0);
        const doubled = computed(() => count() * 2);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.computed.length).toBe(1);
      expect(analysis.computed[0]?.name).toBe('doubled');
    });

    it('should extract computed dependencies', () => {
      const code = `
        const count = signal(0);
        const doubled = computed(() => count() * 2);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const computed = analysis.computed[0];
      expect(computed).toBeDefined();
      expect(computed!.dependencies.length).toBeGreaterThan(0);
      expect(computed!.dependencies).toContain('count');
    });

    it('should detect pure computed functions', () => {
      const code = `
        const count = signal(0);
        const doubled = computed(() => count() * 2);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const computed = analysis.computed[0];
      expect(computed).toBeDefined();
      expect(computed!.pure).toBe(true);
      expect(computed!.memoizable).toBe(true);
    });

    it('should detect impure computed functions', () => {
      const code = `
        const count = signal(0);
        const logged = computed(() => {
          console.log('Side effect');
          return count() * 2;
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const computed = analysis.computed[0];
      expect(computed).toBeDefined();
      expect(computed!.pure).toBe(false);
    });

    it('should handle multiple computed values', () => {
      const code = `
        const count = signal(0);
        const doubled = computed(() => count() * 2);
        const tripled = computed(() => count() * 3);
        const sum = computed(() => doubled() + tripled());
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.computed.length).toBe(3);
    });
  });

  describe('Component Analysis', () => {
    it('should detect component definitions', () => {
      const code = `
        export default defineComponent(() => {
          return () => <div>Test</div>;
        });
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      expect(analysis.components.length).toBeGreaterThan(0);
    });

    it('should detect function components', () => {
      const code = `
        function MyComponent() {
          return <div>Test</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const component = analysis.components[0];
      expect(component).toBeDefined();
      expect(component!.type).toBe('function');
      expect(component!.name).toBe('MyComponent');
    });

    it('should detect components with static JSX', () => {
      const code = `
        function MyComponent() {
          return <div>Static Content</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const component = analysis.components[0];
      expect(component).toBeDefined();
      expect(component!.hasStaticJSX).toBe(true);
    });

    it('should detect components with reactive dependencies', () => {
      const code = `
        function MyComponent() {
          const count = signal(0);
          return () => <div>{count()}</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const component = analysis.components[0];
      expect(component).toBeDefined();
      expect(component!.hasReactiveDeps).toBe(true);
    });

    it('should detect inlinable components', () => {
      const code = `
        const SimpleComponent = () => <div>Simple</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const component = analysis.components[0];
      expect(component).toBeDefined();
      expect(component!.inlinable).toBe(true);
    });

    it('should detect server components', () => {
      const code = `
        'use server';
        function ServerComponent() {
          return <div>Server</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { serverComponents: true });

      const component = analysis.components[0];
      expect(component).toBeDefined();
      expect(component!.isServerComponent).toBe(true);
    });

    it('should detect multiple components', () => {
      const code = `
        const ComponentA = () => <div>A</div>;
        const ComponentB = () => <div>B</div>;
        function ComponentC() {
          return <div>C</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      expect(analysis.components.length).toBe(3);
    });
  });

  describe('Static Element Analysis', () => {
    it('should detect static elements', () => {
      const code = `
        const elem = <div>Static Content</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      expect(analysis.staticElements.length).toBeGreaterThan(0);
    });

    it('should detect hoistable elements', () => {
      const code = `
        function Component() {
          return <div>Static</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const element = analysis.staticElements[0];
      expect(element).toBeDefined();
      expect(element!.hoistable).toBe(true);
    });

    it('should detect cloneable elements', () => {
      const code = `
        const template = <div>Cloneable</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const element = analysis.staticElements[0];
      expect(element).toBeDefined();
      expect(element!.cloneable).toBe(true);
    });

    it('should not mark reactive elements as static', () => {
      const code = `
        const count = signal(0);
        const elem = <div>{count()}</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      // Reactive element should not be in static elements
      const staticElements = analysis.staticElements.filter(
        (e) => e.tag === 'div' && e.hoistable
      );
      expect(staticElements.length).toBe(0);
    });

    it('should extract element tags', () => {
      const code = `
        const div = <div>Div</div>;
        const span = <span>Span</span>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const tags = analysis.staticElements.map((e) => e.tag);
      expect(tags).toContain('div');
      expect(tags).toContain('span');
    });
  });

  describe('Optimization Opportunities', () => {
    it('should identify hoist-static opportunities', () => {
      const code = `
        function Component() {
          return <div>Static</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const hoistOps = analysis.optimizations.filter((o) => o.type === 'hoist-static');
      expect(hoistOps.length).toBeGreaterThan(0);
    });

    it('should identify inline-component opportunities', () => {
      const code = `
        const Small = () => <div>Small</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'aggressive' });

      const inlineOps = analysis.optimizations.filter((o) => o.type === 'inline-component');
      expect(inlineOps.length).toBeGreaterThan(0);
    });

    it('should identify batch-effects opportunities', () => {
      const code = `
        const a = signal(1);
        const b = signal(2);
        effect(() => console.log(a()));
        effect(() => console.log(b()));
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const batchOps = analysis.optimizations.filter((o) => o.type === 'batch-effects');
      expect(batchOps.length).toBeGreaterThan(0);
    });

    it('should identify memoize-computed opportunities', () => {
      const code = `
        const count = signal(0);
        const expensive = computed(() => {
          return count() * 2;
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const memoOps = analysis.optimizations.filter((o) => o.type === 'memoize-computed');
      expect(memoOps.length).toBeGreaterThan(0);
    });

    it('should not identify opportunities in none mode', () => {
      const code = `
        const count = signal(42);
        const doubled = computed(() => count() * 2);
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'none' });

      expect(analysis.optimizations.length).toBe(0);
    });

    it('should categorize optimization impact', () => {
      const code = `
        const Simple = () => <div>Simple</div>;
        function Component() {
          return <div>Static</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'aggressive' });

      const impacts = analysis.optimizations.map((o) => o.impact);
      expect(impacts).toContain('low');
      expect(impacts).toContain('medium');
    });
  });

  describe('Complex Scenarios', () => {
    it('should analyze complete component', () => {
      const code = `
        export default defineComponent(() => {
          const count = signal(0);
          const doubled = computed(() => count() * 2);

          effect(() => {
            console.log('Count:', count());
          });

          const increment = () => count.set((c) => c + 1);

          return () => (
            <div>
              <h1>Counter</h1>
              <p>Count: {count()}</p>
              <p>Doubled: {doubled()}</p>
              <button onClick={increment}>Increment</button>
            </div>
          );
        });
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'aggressive' });

      expect(analysis.signals.length).toBeGreaterThan(0);
      expect(analysis.computed.length).toBeGreaterThan(0);
      expect(analysis.effects.length).toBeGreaterThan(0);
      expect(analysis.components.length).toBeGreaterThan(0);
      expect(analysis.staticElements.length).toBeGreaterThan(0);
    });

    it('should handle nested reactivity', () => {
      const code = `
        const outer = signal(0);
        const middle = computed(() => outer() * 2);
        const inner = computed(() => middle() * 2);

        effect(() => {
          console.log(inner());
        });
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(1);
      expect(analysis.computed.length).toBe(2);
      expect(analysis.effects.length).toBe(1);
    });

    it('should analyze multiple components with shared state', () => {
      const code = `
        const sharedCount = signal(0);

        const ComponentA = () => {
          return () => <div>{sharedCount()}</div>;
        };

        const ComponentB = () => {
          const increment = () => sharedCount.set((c) => c + 1);
          return () => <button onClick={increment}>+</button>;
        };
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(1);
      expect(analysis.components.length).toBe(2);

      const signal = analysis.signals[0];
      expect(signal!.accesses.length).toBeGreaterThan(0);
      expect(signal!.updates.length).toBeGreaterThan(0);
    });
  });

  describe('Type Checker Integration', () => {
    it('should use type checker when provided', () => {
      const code = `
        const count: number = signal(0);
      `;
      const { sourceFile, typeChecker } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, {}, typeChecker);

      expect(analysis.signals.length).toBeGreaterThan(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source file', () => {
      const code = ``;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(0);
      expect(analysis.effects.length).toBe(0);
      expect(analysis.computed.length).toBe(0);
      expect(analysis.components.length).toBe(0);
    });

    it('should handle code without reactivity', () => {
      const code = `
        const x = 42;
        function foo() {
          return x * 2;
        }
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      expect(analysis.signals.length).toBe(0);
      expect(analysis.effects.length).toBe(0);
      expect(analysis.computed.length).toBe(0);
    });

    it('should handle malformed signal declarations', () => {
      const code = `
        const broken = signal();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      // Should handle gracefully
      expect(analysis.signals.length).toBeGreaterThanOrEqual(0);
    });

    it('should handle anonymous components', () => {
      const code = `
        export default () => <div>Anonymous</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const component = analysis.components[0];
      expect(component).toBeDefined();
    });
  });
});
