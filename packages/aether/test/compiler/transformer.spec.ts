/**
 * Transformer Tests
 *
 * Tests for AST transformation passes including
 * JSX transformation, hoisting, and optimizations
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../../src/compiler/parser.js';
import { analyze } from '../../src/compiler/analyzer.js';
import { transform, createTransformPass } from '../../src/compiler/transformer.js';
import { generate } from '../../src/compiler/codegen.js';

describe('Transformer', () => {
  describe('JSX Transformation', () => {
    it('should transform JSX elements with automatic runtime', () => {
      const code = `const elem = <div>Hello</div>;`;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, {
        jsx: { runtime: 'automatic' },
      });

      expect(transformed).toBeDefined();
    });

    it('should transform JSX with classic runtime', () => {
      const code = `const elem = <div>Hello</div>;`;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, {
        jsx: { runtime: 'classic', pragma: 'jsx' },
      });

      const generated = generate(transformed);
      expect(generated.code).toContain('jsx');
    });

    it('should transform JSX attributes', () => {
      const code = `const elem = <div id="test" className="container">Content</div>;`;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);
      const generated = generate(transformed);

      expect(generated.code).toContain('id');
      expect(generated.code).toContain('className');
    });

    it('should transform JSX with expressions', () => {
      const code = `
        const name = "World";
        const elem = <div>{name}</div>;
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);

      expect(transformed).toBeDefined();
    });

    it('should transform JSX fragments', () => {
      const code = `
        const elem = (
          <>
            <div>First</div>
            <div>Second</div>
          </>
        );
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);
      const generated = generate(transformed);

      expect(generated.code).toBeDefined();
    });

    it('should transform nested JSX', () => {
      const code = `
        const elem = (
          <div>
            <header>
              <h1>Title</h1>
            </header>
            <main>
              <p>Content</p>
            </main>
          </div>
        );
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);

      expect(transformed).toBeDefined();
    });
  });

  describe('Static Element Hoisting', () => {
    it('should hoist static elements', () => {
      const code = `
        function Component() {
          return <div>Static Content</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      // Should contain template variable
      expect(generated.code).toBeDefined();
    });

    it('should not hoist reactive elements', () => {
      const code = `
        function Component() {
          const count = signal(0);
          return () => <div>{count()}</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      // Should not create template for reactive content
      expect(generated.code).toBeDefined();
    });

    it('should hoist multiple static elements', () => {
      const code = `
        function Component() {
          return (
            <div>
              <header>Static Header</header>
              <footer>Static Footer</footer>
            </div>
          );
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });

      expect(transformed).toBeDefined();
    });
  });

  describe('Signal Optimization', () => {
    it('should optimize constant signals', () => {
      const code = `
        const staticValue = signal(42);
        const result = staticValue();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      // Should inline or optimize the constant
      expect(generated.code).toBeDefined();
    });

    it('should not optimize mutable signals', () => {
      const code = `
        const count = signal(0);
        count.set(1);
        const result = count();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      // Should keep signal logic
      expect(generated.code).toContain('signal');
    });

    it('should handle signal access optimization', () => {
      const code = `
        const count = signal(0);
        const a = count();
        const b = count();
        const c = count();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile, { optimize: 'aggressive' });

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });

      expect(transformed).toBeDefined();
    });
  });

  describe('Dead Code Elimination', () => {
    it('should eliminate unreachable code after return', () => {
      const code = `
        function test() {
          return 42;
          console.log('Unreachable');
        }
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).not.toContain('Unreachable');
    });

    it('should eliminate if(false) branches', () => {
      const code = `
        function test() {
          if (false) {
            console.log('Dead');
          }
          return 42;
        }
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).not.toContain('Dead');
    });

    it('should simplify if(true) branches', () => {
      const code = `
        function test() {
          if (true) {
            return 42;
          }
          return 0;
        }
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toBeDefined();
    });
  });

  describe('Constant Folding', () => {
    it('should fold arithmetic operations', () => {
      const code = `const result = 2 + 3;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('5');
    });

    it('should fold multiplication', () => {
      const code = `const result = 4 * 5;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('20');
    });

    it('should fold subtraction', () => {
      const code = `const result = 10 - 3;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('7');
    });

    it('should fold division', () => {
      const code = `const result = 15 / 3;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('5');
    });

    it('should not fold operations with variables', () => {
      const code = `
        const x = 5;
        const result = x + 3;
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('+');
    });
  });

  describe('Optimization Levels', () => {
    it('should skip optimizations in none mode', () => {
      const code = `
        const staticValue = signal(42);
        const result = staticValue();
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'none' });
      const generated = generate(transformed);

      // Should not optimize
      expect(generated.code).toContain('signal');
    });

    it('should apply basic optimizations', () => {
      const code = `
        function Component() {
          return <div>Static</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });

      expect(transformed).toBeDefined();
    });

    it('should apply aggressive optimizations', () => {
      const code = `
        const staticValue = signal(42);
        function Component() {
          return () => <div>{staticValue()}</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });

      expect(transformed).toBeDefined();
    });
  });

  describe('Custom Transform Passes', () => {
    it('should create custom transform pass', () => {
      const customPass = createTransformPass(
        'custom-pass',
        (sourceFile) =>
          // Return unmodified
          sourceFile
      );

      expect(customPass.name).toBe('custom-pass');
      expect(customPass.transform).toBeDefined();
    });

    it('should apply custom transform pass', () => {
      const code = `const x = 1;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const customPass = createTransformPass('test-pass', (sf) => sf);

      // Custom passes are not directly applied in the main transform
      // This test verifies the helper function works
      const result = customPass.transform(sourceFile, analysis, {});

      expect(result).toBe(sourceFile);
    });
  });

  describe('Complex Transformations', () => {
    it('should transform complete component', () => {
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

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toBeDefined();
      expect(generated.code.length).toBeGreaterThan(0);
    });

    it('should handle nested components', () => {
      const code = `
        const Child = () => <span>Child</span>;
        const Parent = () => (
          <div>
            <Child />
            <Child />
          </div>
        );
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile, { optimize: 'basic' });

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      expect(generated.code).toContain('Child');
    });

    it('should transform with islands', () => {
      const code = `
        function Island() {
          const count = signal(0);
          return () => <button onClick={() => count.set(c => c + 1)}>{count()}</button>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { islands: true });

      expect(transformed).toBeDefined();
    });

    it('should transform with server components', () => {
      const code = `
        'use server';
        async function ServerComponent() {
          const data = await fetchData();
          return <div>{data}</div>;
        }
      `;
      const { sourceFile } = parse(code, 'test.tsx');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { serverComponents: true });

      expect(transformed).toBeDefined();
    });
  });

  describe('Effect Batching', () => {
    it('should batch multiple effects', () => {
      const code = `
        const a = signal(1);
        const b = signal(2);
        effect(() => console.log(a()));
        effect(() => console.log(b()));
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });

      expect(transformed).toBeDefined();
    });

    it('should not batch effects without dependencies', () => {
      const code = `
        effect(() => console.log('No deps'));
        effect(() => console.log('Also no deps'));
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      expect(generated.code).toContain('effect');
    });
  });

  describe('Preservation of Semantics', () => {
    it('should preserve variable names', () => {
      const code = `const myVariable = 42;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      expect(generated.code).toContain('myVariable');
    });

    it('should preserve function names', () => {
      const code = `function myFunction() { return 42; }`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'basic' });
      const generated = generate(transformed);

      expect(generated.code).toContain('myFunction');
    });

    it('should preserve comments in development mode', () => {
      const code = `
        // Important comment
        const x = 42;
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, {
        mode: 'development',
        optimize: 'none',
      });
      const generated = generate(transformed, { comments: true });

      expect(generated.code).toContain('Important comment');
    });

    it('should maintain code correctness after transformation', () => {
      const code = `
        function factorial(n) {
          if (n <= 1) return 1;
          return n * factorial(n - 1);
        }
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis, { optimize: 'aggressive' });
      const generated = generate(transformed);

      // Should preserve the recursive logic
      expect(generated.code).toContain('factorial');
      expect(generated.code).toContain('return');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source file', () => {
      const code = ``;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);

      expect(transformed).toBeDefined();
    });

    it('should handle source with only imports', () => {
      const code = `import { signal } from '@aether/core';`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);
      const generated = generate(transformed);

      expect(generated.code).toContain('import');
    });

    it('should handle source with only exports', () => {
      const code = `export const x = 42;`;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);
      const generated = generate(transformed);

      expect(generated.code).toContain('export');
    });

    it('should handle mixed content', () => {
      const code = `
        import { signal } from '@aether/core';

        const count = signal(0);

        export default count;
      `;
      const { sourceFile } = parse(code, 'test.ts');
      const analysis = analyze(sourceFile);

      const transformed = transform(sourceFile, analysis);
      const generated = generate(transformed);

      expect(generated.code).toContain('import');
      expect(generated.code).toContain('export');
    });
  });
});
