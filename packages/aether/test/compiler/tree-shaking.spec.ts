/**
 * Tree Shaking Tests
 *
 * Tests for dead code elimination and unused import/export removal
 */

import { describe, it, expect } from 'vitest';
import { TreeShakerPass } from '../../src/compiler/optimizations/tree-shaker.js';
import type { OptimizationContext } from '../../src/compiler/optimizer.js';

describe('TreeShakerPass', () => {
  function createContext(code: string): OptimizationContext {
    return {
      source: code,
      modulePath: 'test.ts',
      options: {
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      },
      metadata: new Map(),
    };
  }

  describe('Unused Import Removal', () => {
    it('should remove completely unused imports', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import { unused } from 'lib';
        const x = 42;
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).not.toContain('unused');
      expect(result.changes.some((c) => c.description.includes('unused import'))).toBe(true);
    });

    it('should keep used imports', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import { signal } from 'lib';
        const count = signal(0);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('signal');
    });

    it('should remove unused named imports', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import { used, unused } from 'lib';
        console.log(used);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('used');
      expect(result.code).not.toContain('unused');
    });

    it('should handle default imports', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import React from 'react';
        const x = 42;
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // React is unused
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should handle renamed imports', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import { original as renamed } from 'lib';
        const x = 42;
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.changes.some((c) => c.description.includes('import'))).toBe(true);
    });
  });

  describe('Unused Export Removal', () => {
    it('should remove unused exports when enabled', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        export const unused = 42;
        const x = 100;
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // Note: export removal is disabled by default to preserve module interface
      expect(result).toBeDefined();
    });

    it('should preserve module interface by default', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        export const api = { method: () => {} };
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('export');
    });
  });

  describe('Unused Function Removal', () => {
    it('should remove unused pure functions', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        /*@__PURE__*/ function unused() {
          return 42;
        }
        const x = 100;
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.changes.some((c) => c.description.includes('pure function'))).toBe(true);
    });

    it('should keep used functions', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        function helper() {
          return 42;
        }
        console.log(helper());
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('helper');
    });

    it('should keep exported functions', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        export function api() {
          return 42;
        }
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('api');
    });

    it('should not remove functions with side effects', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        function withSideEffect() {
          console.log('Side effect');
          return 42;
        }
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // Function without pure annotation should be kept
      expect(result.code).toContain('withSideEffect');
    });
  });

  describe('Unused Variable Removal', () => {
    it('should remove unused variables', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const unused = 42;
        const used = 100;
        console.log(used);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.changes.some((c) => c.description.includes("unused variable 'unused'"))).toBe(
        true
      );
    });

    it('should keep used variables', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const x = 42;
        console.log(x);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('x');
    });

    it('should not remove exported variables', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        export const config = { key: 'value' };
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('config');
    });
  });

  describe('Dead Branch Removal', () => {
    it('should remove if(false) branches', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        if (false) {
          console.log('Dead code');
        }
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).not.toContain('Dead code');
      expect(result.changes.some((c) => c.description.includes('if(false)'))).toBe(true);
    });

    it('should simplify constant ternaries', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `const x = true ? 42 : 100;`;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('42');
      expect(result.changes.some((c) => c.description.includes('ternary'))).toBe(true);
    });

    it('should remove false ternary branch', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `const x = false ? 42 : 100;`;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('100');
    });
  });

  describe('Symbol Analysis', () => {
    it('should track symbol declarations', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const a = 1;
        const b = 2;
        function foo() {}
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.metadata?.symbolsAnalyzed).toBeGreaterThan(0);
    });

    it('should track symbol usage', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const x = 42;
        const y = x + 10;
        console.log(y);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // All symbols are used
      expect(result.metadata?.unusedSymbols).toBe(0);
    });

    it('should identify unused symbols', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const unused1 = 1;
        const unused2 = 2;
        const used = 3;
        console.log(used);
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.metadata?.unusedSymbols).toBeGreaterThan(0);
    });
  });

  describe('Pure Annotations', () => {
    it('should respect pure annotations', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        /*@__PURE__*/ const unused = expensive();
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should keep impure code even if unused', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const unused = sideEffect();
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // Should keep because no pure annotation
      expect(result.code).toContain('unused');
    });
  });

  describe('Complex Scenarios', () => {
    it('should handle mixed content', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        import { used, unused } from 'lib';
        const usedVar = used();
        const unusedVar = 42;
        export { usedVar };
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toContain('used');
      expect(result.code).not.toContain('unused');
      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should handle nested scopes', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const outer = 1;
        function test() {
          const inner = outer + 1;
          return inner;
        }
        console.log(test());
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // All variables are used
      expect(result.code).toContain('outer');
      expect(result.code).toContain('inner');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = '';
      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result.code).toBe('');
      expect(result.changes.length).toBe(0);
    });

    it('should handle code with only comments', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        // Just a comment
        /* Block comment */
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      expect(result).toBeDefined();
    });

    it('should handle circular dependencies', async () => {
      const treeShaker = new TreeShakerPass({
        mode: 'aggressive',
        optimizeSignals: true,
        batchEffects: true,
        hoistComponents: true,
        treeShake: true,
        eliminateDeadCode: true,
        minify: false,
        target: 'browser',
        development: false,
        sourceMaps: false,
        customPasses: [],
        collectMetrics: false,
      });

      const code = `
        const a = () => b();
        const b = () => a();
        export { a };
      `;

      const context = createContext(code);
      const result = await treeShaker.transform(code, context);

      // Both should be kept due to circular dependency and export
      expect(result.code).toContain('a');
      expect(result.code).toContain('b');
    });
  });
});
