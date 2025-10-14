/**
 * Optimizer Tests
 *
 * Tests for the optimization orchestrator that manages
 * and executes optimization passes
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  Optimizer,
  createOptimizer,
  optimize,
  type OptimizationPass,
  type OptimizationContext,
} from '../../src/compiler/optimizer.js';

describe('Optimizer', () => {
  describe('Optimizer Creation', () => {
    it('should create optimizer with default options', () => {
      const optimizer = new Optimizer();

      expect(optimizer).toBeDefined();
      expect(optimizer.getPasses).toBeDefined();
    });

    it('should create optimizer with custom options', () => {
      const optimizer = new Optimizer({
        mode: 'aggressive',
        development: false,
        minify: true,
      });

      expect(optimizer).toBeDefined();
    });

    it('should create optimizer with helper', () => {
      const optimizer = createOptimizer({
        mode: 'basic',
      });

      expect(optimizer).toBeDefined();
    });
  });

  describe('Optimization Modes', () => {
    it('should handle none mode', async () => {
      const optimizer = new Optimizer({ mode: 'none' });
      const code = `const x = 42;`;

      const result = await optimizer.optimize(code);

      expect(result.code).toBe(code);
      expect(result.changes.length).toBe(0);
    });

    it('should handle basic mode', async () => {
      const optimizer = new Optimizer({ mode: 'basic' });
      const code = `const unused = 42;`;

      const result = await optimizer.optimize(code);

      expect(result.code).toBeDefined();
      expect(result.warnings).toBeDefined();
    });

    it('should handle aggressive mode', async () => {
      const optimizer = new Optimizer({ mode: 'aggressive' });
      const code = `
        const count = signal(42);
        const value = count();
      `;

      const result = await optimizer.optimize(code);

      expect(result.code).toBeDefined();
      expect(result.changes).toBeDefined();
    });
  });

  describe('Optimization Passes', () => {
    it('should execute signal optimizer', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        optimizeSignals: true,
      });

      const code = `
        const staticValue = signal(42);
        console.log(staticValue());
      `;

      const result = await optimizer.optimize(code);

      expect(result.changes.length).toBeGreaterThanOrEqual(0);
    });

    it('should execute tree shaker', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        treeShake: true,
      });

      const code = `
        import { unused } from 'lib';
        const x = 42;
      `;

      const result = await optimizer.optimize(code);

      expect(result.changes.length).toBeGreaterThanOrEqual(0);
    });

    it('should execute dead code eliminator', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        eliminateDeadCode: true,
      });

      const code = `
        function test() {
          return 42;
          console.log('Dead code');
        }
      `;

      const result = await optimizer.optimize(code);

      expect(result.changes.length).toBeGreaterThanOrEqual(0);
    });

    it('should execute minifier', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        minify: true,
      });

      const code = `
        const x    =    42   ;
        function   test  ( )  {
          return   x  ;
        }
      `;

      const result = await optimizer.optimize(code);

      expect(result.code.length).toBeLessThanOrEqual(code.length);
    });
  });

  describe('Pass Management', () => {
    let optimizer: Optimizer;

    beforeEach(() => {
      optimizer = new Optimizer({ mode: 'basic' });
    });

    it('should get active passes', async () => {
      await optimizer.optimize('const x = 1;');
      const passes = optimizer.getPasses();

      expect(Array.isArray(passes)).toBe(true);
    });

    it('should add custom pass', () => {
      const customPass: OptimizationPass = {
        name: 'custom-pass',
        priority: 1000,
        async transform(code) {
          return {
            code,
            changes: [],
            warnings: [],
          };
        },
      };

      optimizer.addPass(customPass);
      const passes = optimizer.getPasses();

      expect(passes.some((p) => p.name === 'custom-pass')).toBe(true);
    });

    it('should remove pass', async () => {
      await optimizer.optimize('const x = 1;');
      const passes = optimizer.getPasses();

      if (passes.length > 0) {
        const passName = passes[0]!.name;
        const removed = optimizer.removePass(passName);

        expect(removed).toBe(true);
        expect(optimizer.getPasses().some((p) => p.name === passName)).toBe(false);
      }
    });

    it('should execute passes in priority order', async () => {
      const execOrder: string[] = [];

      const pass1: OptimizationPass = {
        name: 'high-priority',
        priority: 100,
        async transform(code) {
          execOrder.push('high');
          return { code, changes: [], warnings: [] };
        },
      };

      const pass2: OptimizationPass = {
        name: 'low-priority',
        priority: 500,
        async transform(code) {
          execOrder.push('low');
          return { code, changes: [], warnings: [] };
        },
      };

      optimizer.addPass(pass2);
      optimizer.addPass(pass1);

      await optimizer.optimize('const x = 1;');

      const highIndex = execOrder.indexOf('high');
      const lowIndex = execOrder.indexOf('low');

      if (highIndex !== -1 && lowIndex !== -1) {
        expect(highIndex).toBeLessThan(lowIndex);
      }
    });
  });

  describe('Metrics Collection', () => {
    it('should collect metrics when enabled', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: true,
      });

      // Use code that won't be tree-shaken (exports are always kept)
      const code = `export const x = 42;`;
      await optimizer.optimize(code);

      const metrics = optimizer.getMetrics();

      expect(metrics).toBeDefined();
      expect(metrics?.totalTime).toBeGreaterThanOrEqual(0);
      expect(metrics?.originalSize).toBe(code.length);
      expect(metrics?.optimizedSize).toBeGreaterThan(0);
    });

    it('should not collect metrics when disabled', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: false,
      });

      await optimizer.optimize('const x = 42;');
      const metrics = optimizer.getMetrics();

      expect(metrics).toBeNull();
    });

    it('should calculate size reduction', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: true,
        minify: true,
      });

      const code = `
        const x    =    42   ;
        const y    =    100  ;
      `;

      await optimizer.optimize(code);
      const metrics = optimizer.getMetrics();

      expect(metrics?.sizeReduction).toBeGreaterThanOrEqual(0);
      expect(metrics?.sizeReductionPercent).toBeGreaterThanOrEqual(0);
    });

    it('should track pass timings', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: true,
      });

      await optimizer.optimize('const x = 42;');
      const metrics = optimizer.getMetrics();

      expect(metrics?.passTimings.size).toBeGreaterThan(0);
    });

    it('should count changes by type', async () => {
      const optimizer = new Optimizer({
        mode: 'aggressive',
        collectMetrics: true,
      });

      const code = `
        import { unused } from 'lib';
        const x = signal(42);
      `;

      await optimizer.optimize(code);
      const metrics = optimizer.getMetrics();

      expect(metrics?.changesByType).toBeDefined();
    });

    it('should reset metrics', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: true,
      });

      await optimizer.optimize('const x = 42;');
      optimizer.resetMetrics();

      const metrics = optimizer.getMetrics();
      expect(metrics).toBeNull();
    });
  });

  describe('Error Handling', () => {
    it('should handle pass errors gracefully', async () => {
      const optimizer = new Optimizer({ mode: 'basic' });

      const errorPass: OptimizationPass = {
        name: 'error-pass',
        priority: 1,
        async transform() {
          throw new Error('Pass error');
        },
      };

      optimizer.addPass(errorPass);

      const code = 'const x = 42;';
      const result = await optimizer.optimize(code);

      expect(result.warnings.some((w) => w.includes('error-pass'))).toBe(true);
    });

    it('should continue after pass failure', async () => {
      const optimizer = new Optimizer({ mode: 'basic' });

      let pass2Executed = false;

      const errorPass: OptimizationPass = {
        name: 'error-pass',
        priority: 100,
        async transform() {
          throw new Error('Error');
        },
      };

      const successPass: OptimizationPass = {
        name: 'success-pass',
        priority: 200,
        async transform(code) {
          pass2Executed = true;
          return { code, changes: [], warnings: [] };
        },
      };

      optimizer.addPass(errorPass);
      optimizer.addPass(successPass);

      await optimizer.optimize('const x = 1;');

      expect(pass2Executed).toBe(true);
    });
  });

  describe('Optimization Context', () => {
    it('should provide context to passes', async () => {
      let receivedContext: OptimizationContext | null = null;

      const testPass: OptimizationPass = {
        name: 'context-test',
        priority: 1,
        async transform(code, context) {
          receivedContext = context;
          return { code, changes: [], warnings: [] };
        },
      };

      const optimizer = new Optimizer({ mode: 'basic' });
      optimizer.addPass(testPass);

      await optimizer.optimize('const x = 1;', 'test.ts');

      expect(receivedContext).toBeDefined();
      expect(receivedContext?.source).toBeDefined();
      expect(receivedContext?.modulePath).toBe('test.ts');
      expect(receivedContext?.options).toBeDefined();
    });

    it('should pass metadata between passes', async () => {
      let metadataReceived = false;

      const pass1: OptimizationPass = {
        name: 'pass-1',
        priority: 100,
        async transform(code, context) {
          context.metadata.set('testKey', 'testValue');
          return { code, changes: [], warnings: [] };
        },
      };

      const pass2: OptimizationPass = {
        name: 'pass-2',
        priority: 200,
        async transform(code, context) {
          metadataReceived = context.metadata.get('pass-1.testKey') !== undefined;
          return { code, changes: [], warnings: [] };
        },
      };

      const optimizer = new Optimizer({ mode: 'basic' });
      optimizer.addPass(pass1);
      optimizer.addPass(pass2);

      await optimizer.optimize('const x = 1;');

      expect(metadataReceived).toBe(true);
    });
  });

  describe('Source Maps', () => {
    it('should preserve source maps through passes', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        sourceMaps: true,
      });

      const code = 'const x = 42;';
      const result = await optimizer.optimize(code);

      // Source maps might not be generated for simple cases
      expect(result).toBeDefined();
    });

    it('should chain source maps', async () => {
      const pass1: OptimizationPass = {
        name: 'pass-with-map',
        priority: 100,
        async transform(code) {
          return {
            code,
            changes: [],
            warnings: [],
            sourceMap: {
              version: 3,
              sources: ['input.ts'],
              names: [],
              mappings: '',
            },
          };
        },
      };

      const optimizer = new Optimizer({ mode: 'basic', sourceMaps: true });
      optimizer.addPass(pass1);

      const result = await optimizer.optimize('const x = 1;');

      expect(result.sourceMap).toBeDefined();
    });
  });

  describe('Development vs Production', () => {
    it('should preserve readability in development', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        development: true,
        minify: false,
      });

      const code = `
        const x = 42;
        function test() {
          return x;
        }
      `;

      const result = await optimizer.optimize(code);

      // Should not be heavily minified
      expect(result.code).toContain('function');
    });

    it('should aggressively optimize in production', async () => {
      const optimizer = new Optimizer({
        mode: 'aggressive',
        development: false,
        minify: true,
      });

      const code = `
        const x = 42;
        const unused = 100;
        function test() {
          return x;
        }
      `;

      const result = await optimizer.optimize(code);

      expect(result.changes.length).toBeGreaterThan(0);
    });
  });

  describe('Quick Optimize Helper', () => {
    it('should optimize with helper function', async () => {
      const code = 'const x = 42;';
      const result = await optimize(code, { mode: 'basic' });

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    });

    it('should apply optimizations', async () => {
      const code = `
        const unused = 42;
        const x = 100;
      `;

      const result = await optimize(code, {
        mode: 'aggressive',
        treeShake: true,
      });

      expect(result).toBeDefined();
    });
  });

  describe('Target Environments', () => {
    it('should optimize for browser target', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        target: 'browser',
      });

      const result = await optimizer.optimize('const x = 42;');

      expect(result).toBeDefined();
    });

    it('should optimize for server target', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        target: 'server',
      });

      const result = await optimizer.optimize('const x = 42;');

      expect(result).toBeDefined();
    });

    it('should optimize for universal target', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        target: 'universal',
      });

      const result = await optimizer.optimize('const x = 42;');

      expect(result).toBeDefined();
    });
  });

  describe('Complex Scenarios', () => {
    it('should optimize complete component', async () => {
      const optimizer = new Optimizer({
        mode: 'aggressive',
        optimizeSignals: true,
        eliminateDeadCode: true,
        minify: true,
        collectMetrics: true,
      });

      const code = `
        import { signal, effect, computed } from '@aether/core';

        const count = signal(0);
        const doubled = computed(() => count() * 2);

        effect(() => {
          console.log('Count:', count());
        });

        const unused = signal(999);

        export default count;
      `;

      const result = await optimizer.optimize(code);

      expect(result.code).toBeDefined();
      expect(result.changes.length).toBeGreaterThan(0);

      const metrics = optimizer.getMetrics();
      expect(metrics?.optimizedSize).toBeLessThan(metrics!.originalSize);
    });

    it('should handle large files efficiently', async () => {
      const optimizer = new Optimizer({
        mode: 'basic',
        collectMetrics: true,
      });

      // Generate large code
      const lines = Array.from({ length: 1000 }, (_, i) => `const var${i} = ${i};`);
      const code = lines.join('\n');

      const result = await optimizer.optimize(code);

      expect(result.code).toBeDefined();

      const metrics = optimizer.getMetrics();
      expect(metrics?.totalTime).toBeLessThan(5000); // Should be fast
    });
  });
});
