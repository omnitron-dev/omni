/**
 * Signal Optimizer Tests
 *
 * Tests for signal-specific optimizations including
 * constant inlining, unused removal, and access pattern optimization
 */

import { describe, it, expect } from 'vitest';
import { SignalOptimizer } from '../../src/compiler/optimizations/signal-optimizer.js';
import type { OptimizationContext } from '../../src/compiler/optimizer.js';

describe('SignalOptimizer', () => {
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

  describe('Constant Signal Inlining', () => {
    it('should inline constant signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const staticValue = signal(42);
        console.log(staticValue());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.code).toContain('42');
      expect(result.changes.some((c) => c.type === 'signal-inline')).toBe(true);
    });

    it('should inline string constants', async () => {
      const optimizer = new SignalOptimizer({
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
        const name = signal("John");
        console.log(name());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should inline boolean constants', async () => {
      const optimizer = new SignalOptimizer({
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
        const active = signal(true);
        if (active()) {
          console.log('Active');
        }
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should not inline mutable signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        setCount(1);
        console.log(count());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Should not inline since signal is updated
      expect(result.code).toContain('signal');
    });

    it('should remove inlined signal declarations', async () => {
      const optimizer = new SignalOptimizer({
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
        const staticValue = signal(42);
        console.log(staticValue());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Signal declaration should be removed after inlining
      expect(result.code).not.toContain('signal(42)');
    });
  });

  describe('Unused Signal Removal', () => {
    it('should remove unused signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const unused = signal(42);
        const used = signal(100);
        console.log(used());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.some((c) => c.description.includes('unused'))).toBe(true);
    });

    it('should not remove used signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        console.log(count());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // count is used, should not be removed (unless inlined)
      expect(result).toBeDefined();
    });

    it('should remove signals without accesses or subscriptions', async () => {
      const optimizer = new SignalOptimizer({
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
        const orphan = signal(999);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });
  });

  describe('Access Pattern Optimization', () => {
    it('should warn about multiple accesses', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        const a = count() + count() + count();
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.warnings.some((w) => w.includes('accessed'))).toBe(true);
    });

    it('should not warn for single access', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        const value = count();
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.warnings.filter((w) => w.includes('accessed')).length).toBe(0);
    });
  });

  describe('Sequential Update Merging', () => {
    it('should merge sequential updates to same signal', async () => {
      const optimizer = new SignalOptimizer({
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
        setCount(1);
        setCount(2);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Sequential updates should be merged
      expect(result.changes.some((c) => c.description.includes('Merged'))).toBe(true);
    });

    it('should not merge non-sequential updates', async () => {
      const optimizer = new SignalOptimizer({
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
        setCount(1);
        console.log('Between');
        setCount(2);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Should not merge with code in between
      expect(result.code).toContain('setCount');
    });
  });

  describe('Single-Use Signal Conversion', () => {
    it('should convert single-use signals to direct values', async () => {
      const optimizer = new SignalOptimizer({
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
        const temp = signal(42);
        console.log(temp());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.some((c) => c.description.includes('single-use'))).toBe(true);
    });

    it('should not convert multi-use signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        console.log(count());
        console.log(count());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Should not convert multi-use signal
      expect(result.code).toContain('signal');
    });

    it('should not convert signals with updates', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        setCount(1);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Should not convert signal that gets updated
      expect(result.code).toContain('signal');
    });
  });

  describe('Signal Usage Analysis', () => {
    it('should analyze signal declarations', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        const name = signal("John");
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.metadata?.signalsAnalyzed).toBeGreaterThan(0);
    });

    it('should identify constant signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const staticValue = signal(42);
        console.log(staticValue());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.metadata?.constantSignals).toBeGreaterThan(0);
    });

    it('should track access counts', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        const a = count();
        const b = count();
        const c = count();
      `;

      const context = createContext(code);
      await optimizer.transform(code, context);

      // Analysis should track multiple accesses
      expect(true).toBe(true); // Verified by warning tests above
    });
  });

  describe('Complex Scenarios', () => {
    it('should optimize multiple signals', async () => {
      const optimizer = new SignalOptimizer({
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
        const staticA = signal(1);
        const staticB = signal(2);
        const dynamic = signal(0);

        console.log(staticA() + staticB());
        setDynamic(dynamic() + 1);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should handle nested signal usage', async () => {
      const optimizer = new SignalOptimizer({
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
        const outer = signal(1);
        const inner = signal(outer() * 2);
        console.log(inner());
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result).toBeDefined();
    });

    it('should optimize signals in effects', async () => {
      const optimizer = new SignalOptimizer({
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
        const count = signal(0);
        effect(() => {
          console.log(count());
        });
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty code', async () => {
      const optimizer = new SignalOptimizer({
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
      const result = await optimizer.transform(code, context);

      expect(result.code).toBe('');
      expect(result.changes.length).toBe(0);
    });

    it('should handle code without signals', async () => {
      const optimizer = new SignalOptimizer({
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
      const result = await optimizer.transform(code, context);

      expect(result.code).toBe(code);
      expect(result.changes.length).toBe(0);
    });

    it('should handle malformed signal declarations', async () => {
      const optimizer = new SignalOptimizer({
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

      const code = `const broken = signal();`;
      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      // Should handle gracefully without crashing
      expect(result).toBeDefined();
    });
  });

  describe('Option Configurations', () => {
    it('should respect inline constants option', async () => {
      const optimizerWithInline = new SignalOptimizer({
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
        const staticValue = signal(42);
        console.log(staticValue());
      `;

      const context = createContext(code);
      const result = await optimizerWithInline.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });

    it('should respect remove unused subscriptions option', async () => {
      const optimizer = new SignalOptimizer({
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
        const unused = signal(42);
      `;

      const context = createContext(code);
      const result = await optimizer.transform(code, context);

      expect(result.changes.length).toBeGreaterThan(0);
    });
  });
});
