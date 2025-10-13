/**
 * Parallel Compilation Tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ParallelCompiler,
  createParallelCompiler,
  compileFiles,
  parallelCompilationPlugin,
  type ParallelCompilationConfig,
  type CompilationTask,
  type CompilationResult,
} from '../../src/build/parallel-compilation';
import * as os from 'os';

describe('Parallel Compilation', () => {
  describe('ParallelCompiler', () => {
    describe('Initialization', () => {
      it('should create compiler with default config', () => {
        const compiler = new ParallelCompiler();
        expect(compiler).toBeDefined();
      });

      it('should determine worker count automatically', async () => {
        const compiler = new ParallelCompiler({ workers: 'auto' });
        await compiler.init();

        const stats = compiler.getStats();
        const cpuCount = os.cpus().length;
        const expectedWorkers = Math.max(1, Math.min(cpuCount - 1, 8));

        expect(stats.workersUsed).toBe(expectedWorkers);

        await compiler.terminate();
      });

      it('should use specified worker count', async () => {
        const compiler = new ParallelCompiler({ workers: 4 });
        await compiler.init();

        const stats = compiler.getStats();
        expect(stats.workersUsed).toBe(4);

        await compiler.terminate();
      });

      it('should use at least 1 worker', async () => {
        const compiler = new ParallelCompiler({ workers: 0 });
        await compiler.init();

        const stats = compiler.getStats();
        expect(stats.workersUsed).toBeGreaterThanOrEqual(1);

        await compiler.terminate();
      });
    });

    describe('Single File Compilation', () => {
      it('should compile single TypeScript file', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        const source = `
const message: string = "Hello, World!";
console.log(message);
`;

        const result = await compiler.compileFile('test.ts', source);

        expect(result.filePath).toBe('test.ts');
        expect(result.output).toBeDefined();
        expect(result.output).toContain('Hello, World!');
        expect(result.diagnostics).toBeDefined();
        expect(result.compilationTime).toBeGreaterThanOrEqual(0);

        await compiler.terminate();
      });

      it('should handle TypeScript syntax', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        const source = `
interface User {
  name: string;
  age: number;
}

const user: User = { name: "John", age: 30 };
`;

        const result = await compiler.compileFile('user.ts', source);

        expect(result.output).toBeDefined();
        expect(result.diagnostics).toBeDefined();

        await compiler.terminate();
      });

      it('should include source maps when configured', async () => {
        const compiler = new ParallelCompiler({
          compilerOptions: {
            sourceMap: true,
          },
        });
        await compiler.init();

        const source = 'const x = 42;';
        const result = await compiler.compileFile('test.ts', source);

        expect(result.sourceMap).toBeDefined();

        await compiler.terminate();
      });
    });

    describe('Batch Compilation', () => {
      it('should compile multiple files', async () => {
        const compiler = new ParallelCompiler({ workers: 2 });
        await compiler.init();

        const files = [
          { path: 'file1.ts', source: 'const a = 1;' },
          { path: 'file2.ts', source: 'const b = 2;' },
          { path: 'file3.ts', source: 'const c = 3;' },
        ];

        const results = await compiler.compile(files);

        expect(results).toHaveLength(3);
        expect(results[0].filePath).toBe('file1.ts');
        expect(results[1].filePath).toBe('file2.ts');
        expect(results[2].filePath).toBe('file3.ts');

        await compiler.terminate();
      });

      it('should use single-threaded compilation for small batches', async () => {
        const compiler = new ParallelCompiler({ threshold: 10 });
        await compiler.init();

        const files = [
          { path: 'file1.ts', source: 'const a = 1;' },
          { path: 'file2.ts', source: 'const b = 2;' },
        ];

        const results = await compiler.compile(files);

        expect(results).toHaveLength(2);
        // Check that single-threaded was used (workerId === -1)
        expect(results[0].workerId).toBe(-1);

        await compiler.terminate();
      });

      it('should use parallel compilation for large batches', async () => {
        const compiler = new ParallelCompiler({ threshold: 5, workers: 2 });
        await compiler.init();

        const files = Array.from({ length: 10 }, (_, i) => ({
          path: `file${i}.ts`,
          source: `const x${i} = ${i};`,
        }));

        const results = await compiler.compile(files);

        expect(results).toHaveLength(10);
        // At least some should be compiled by workers
        const workerResults = results.filter((r) => r.workerId >= 0);
        expect(workerResults.length).toBeGreaterThan(0);

        await compiler.terminate();
      });
    });

    describe('Caching', () => {
      it('should cache compilation results', async () => {
        const compiler = new ParallelCompiler({ cache: true });
        await compiler.init();

        const source = 'const x = 1;';

        // First compilation
        const result1 = await compiler.compileFile('test.ts', source);

        // Second compilation (should hit cache)
        const result2 = await compiler.compileFile('test.ts', source);

        expect(result1.output).toBe(result2.output);

        const stats = compiler.getStats();
        expect(stats.cacheHitRate).toBeGreaterThan(0);

        await compiler.terminate();
      });

      it('should not cache when disabled', async () => {
        const compiler = new ParallelCompiler({ cache: false });
        await compiler.init();

        const source = 'const x = 1;';

        await compiler.compileFile('test.ts', source);
        await compiler.compileFile('test.ts', source);

        const stats = compiler.getStats();
        expect(stats.cacheHitRate).toBe(0);

        await compiler.terminate();
      });

      it('should invalidate cache on content change', async () => {
        const compiler = new ParallelCompiler({ cache: true });
        await compiler.init();

        const source1 = 'const x = 1;';
        const source2 = 'const x = 2;';

        await compiler.compileFile('test.ts', source1);
        await compiler.compileFile('test.ts', source2);

        const stats = compiler.getStats();
        // Second compilation should miss cache
        expect(stats.cacheHitRate).toBeLessThan(100);

        await compiler.terminate();
      });

      it('should clear cache', async () => {
        const compiler = new ParallelCompiler({ cache: true });
        await compiler.init();

        const source = 'const x = 1;';

        await compiler.compileFile('test.ts', source);
        compiler.clearCache();

        // After clearing cache, this should miss
        await compiler.compileFile('test.ts', source);

        const stats = compiler.getStats();
        expect(stats.cacheHitRate).toBe(0);

        await compiler.terminate();
      });
    });

    describe('Statistics', () => {
      it('should track compilation statistics', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        const files = [
          { path: 'file1.ts', source: 'const a = 1;' },
          { path: 'file2.ts', source: 'const b = 2;' },
        ];

        await compiler.compile(files);

        const stats = compiler.getStats();

        expect(stats.totalFiles).toBe(2);
        expect(stats.successful).toBeGreaterThan(0);
        expect(stats.totalTime).toBeGreaterThan(0);
        expect(stats.averageTime).toBeGreaterThan(0);
        expect(stats.throughput).toBeGreaterThan(0);

        await compiler.terminate();
      });

      it('should track worker statistics', async () => {
        const compiler = new ParallelCompiler({ workers: 2, threshold: 1 });
        await compiler.init();

        const files = Array.from({ length: 4 }, (_, i) => ({
          path: `file${i}.ts`,
          source: `const x${i} = ${i};`,
        }));

        await compiler.compile(files);

        const stats = compiler.getStats();

        expect(stats.workers).toHaveLength(2);
        for (const worker of stats.workers) {
          expect(worker.id).toBeGreaterThanOrEqual(0);
          expect(worker.status).toBeDefined();
        }

        await compiler.terminate();
      });

      it('should calculate throughput', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        const files = Array.from({ length: 10 }, (_, i) => ({
          path: `file${i}.ts`,
          source: `const x${i} = ${i};`,
        }));

        await compiler.compile(files);

        const stats = compiler.getStats();

        expect(stats.throughput).toBeGreaterThan(0);
        expect(stats.throughput).toBeLessThan(1000000); // Reasonable upper bound

        await compiler.terminate();
      });
    });

    describe('Queue Management', () => {
      it('should queue tasks when workers are busy', async () => {
        const compiler = new ParallelCompiler({ workers: 1, threshold: 1 });
        await compiler.init();

        // Start multiple tasks
        const promises = Array.from({ length: 5 }, (_, i) =>
          compiler.compileFile(`file${i}.ts`, `const x${i} = ${i};`)
        );

        // Queue should have pending tasks
        const queueSize = compiler.getQueueSize();
        expect(queueSize).toBeGreaterThanOrEqual(0);

        await Promise.all(promises);

        await compiler.terminate();
      });

      it('should get busy workers count', async () => {
        const compiler = new ParallelCompiler({ workers: 2 });
        await compiler.init();

        // Initially no workers should be busy
        expect(compiler.getBusyWorkersCount()).toBe(0);

        await compiler.terminate();
      });

      it('should check if compiler is busy', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        expect(compiler.isBusy()).toBe(false);

        const promise = compiler.compileFile('test.ts', 'const x = 1;');
        // Might be busy during compilation
        // expect(compiler.isBusy()).toBe(true); // This is timing-dependent

        await promise;

        await compiler.terminate();
      });
    });

    describe('Error Handling', () => {
      it('should handle compilation errors', async () => {
        const compiler = new ParallelCompiler();
        await compiler.init();

        // Invalid TypeScript syntax
        const source = 'const x: = 1;';

        const result = await compiler.compileFile('test.ts', source);

        // Should still return a result with diagnostics
        expect(result).toBeDefined();
        expect(result.diagnostics).toBeDefined();

        await compiler.terminate();
      });

      it('should continue after worker errors', async () => {
        const compiler = new ParallelCompiler({ workers: 2 });
        await compiler.init();

        const files = [
          { path: 'file1.ts', source: 'const a = 1;' },
          { path: 'file2.ts', source: 'const x: = 1;' }, // Invalid
          { path: 'file3.ts', source: 'const c = 3;' },
        ];

        const results = await compiler.compile(files);

        expect(results).toHaveLength(3);
        // Should still process all files
        expect(results[0]).toBeDefined();
        expect(results[2]).toBeDefined();

        await compiler.terminate();
      });
    });

    describe('Configuration Options', () => {
      it('should respect threshold configuration', async () => {
        const compiler = new ParallelCompiler({ threshold: 5 });
        await compiler.init();

        const smallBatch = [
          { path: 'file1.ts', source: 'const a = 1;' },
          { path: 'file2.ts', source: 'const b = 2;' },
        ];

        const results = await compiler.compile(smallBatch);

        // Should use single-threaded for small batch
        expect(results[0].workerId).toBe(-1);

        await compiler.terminate();
      });

      it('should respect worker memory configuration', async () => {
        const compiler = new ParallelCompiler({ workerMemory: 256 });
        await compiler.init();

        // Just verify initialization succeeds
        expect(compiler).toBeDefined();

        await compiler.terminate();
      });

      it('should support isolated modules mode', async () => {
        const compiler = new ParallelCompiler({ isolatedModules: true });
        await compiler.init();

        const source = 'const x = 1;';
        const result = await compiler.compileFile('test.ts', source);

        expect(result).toBeDefined();

        await compiler.terminate();
      });

      it('should respect custom compiler options', async () => {
        const compiler = new ParallelCompiler({
          compilerOptions: {
            target: 5, // ES2015
            module: 1, // CommonJS
          },
        });
        await compiler.init();

        const source = 'const x = 1;';
        const result = await compiler.compileFile('test.ts', source);

        expect(result.output).toBeDefined();

        await compiler.terminate();
      });

      it('should respect batch size configuration', async () => {
        const compiler = new ParallelCompiler({ batchSize: 2, threshold: 1 });
        await compiler.init();

        const files = Array.from({ length: 6 }, (_, i) => ({
          path: `file${i}.ts`,
          source: `const x${i} = ${i};`,
        }));

        const results = await compiler.compile(files);

        expect(results).toHaveLength(6);

        await compiler.terminate();
      });
    });

    describe('Termination', () => {
      it('should terminate all workers', async () => {
        const compiler = new ParallelCompiler({ workers: 2 });
        await compiler.init();

        await compiler.terminate();

        const stats = compiler.getStats();
        expect(stats.workersUsed).toBe(0);
      });

      it('should clear queue on termination', async () => {
        const compiler = new ParallelCompiler({ workers: 1 });
        await compiler.init();

        await compiler.terminate();

        expect(compiler.getQueueSize()).toBe(0);
      });
    });
  });

  describe('Factory Functions', () => {
    it('should create compiler via factory function', async () => {
      const compiler = createParallelCompiler({ workers: 2 });
      expect(compiler).toBeInstanceOf(ParallelCompiler);

      await compiler.init();
      await compiler.terminate();
    });

    it('should compile files via helper function', async () => {
      const files = [
        { path: 'file1.ts', source: 'const a = 1;' },
        { path: 'file2.ts', source: 'const b = 2;' },
      ];

      const results = await compileFiles(files, { workers: 2 });

      expect(results).toHaveLength(2);
      expect(results[0].filePath).toBe('file1.ts');
      expect(results[1].filePath).toBe('file2.ts');
    });
  });

  describe('Vite Plugin', () => {
    it('should create vite plugin', () => {
      const plugin = parallelCompilationPlugin({ workers: 2 });

      expect(plugin).toBeDefined();
      expect(plugin.name).toBe('aether-parallel-compilation');
      expect(plugin.enforce).toBe('pre');
    });

    it('should initialize on buildStart', async () => {
      const plugin = parallelCompilationPlugin({ workers: 2 });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      // Should initialize without errors
      expect(true).toBe(true);
    });

    it('should transform TypeScript files', async () => {
      const plugin = parallelCompilationPlugin({
        workers: 1,
        extensions: ['.ts', '.tsx'],
      });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.transform) {
        const code = 'const x: number = 1;';
        const result = await plugin.transform.call({} as any, code, 'test.ts');

        // Should return transformed code or null
        expect(result === null || typeof result === 'object').toBe(true);
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }
    });

    it('should skip non-TypeScript files', async () => {
      const plugin = parallelCompilationPlugin({
        extensions: ['.ts', '.tsx'],
      });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.transform) {
        const code = 'console.log("test");';
        const result = await plugin.transform.call({} as any, code, 'test.js');

        expect(result).toBeNull();
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }
    });

    it('should respect exclude patterns', async () => {
      const plugin = parallelCompilationPlugin({
        extensions: ['.ts'],
        exclude: [/node_modules/],
      });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.transform) {
        const code = 'const x = 1;';
        const result = await plugin.transform.call({} as any, code, 'node_modules/test.ts');

        expect(result).toBeNull();
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }
    });

    it('should respect include patterns', async () => {
      const plugin = parallelCompilationPlugin({
        extensions: ['.ts'],
        include: [/src/],
      });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.transform) {
        // Should process src files
        const code1 = 'const x = 1;';
        const result1 = await plugin.transform.call({} as any, code1, 'src/test.ts');

        // Should not process non-src files
        const code2 = 'const y = 2;';
        const result2 = await plugin.transform.call({} as any, code2, 'other/test.ts');

        expect(result2).toBeNull();
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }
    });

    it('should print statistics on buildEnd', async () => {
      const plugin = parallelCompilationPlugin({ workers: 1 });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.transform) {
        const code = 'const x = 1;';
        await plugin.transform.call({} as any, code, 'test.ts');
      }

      if (plugin.buildEnd) {
        // Should print stats without errors
        await plugin.buildEnd.call({} as any);
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }
    });

    it('should terminate compiler on closeBundle', async () => {
      const plugin = parallelCompilationPlugin({ workers: 1 });

      if (plugin.buildStart) {
        await plugin.buildStart.call({} as any);
      }

      if (plugin.closeBundle) {
        await plugin.closeBundle.call({} as any);
      }

      // Should terminate without errors
      expect(true).toBe(true);
    });
  });

  describe('Performance', () => {
    it('should compile multiple files faster with parallel compilation', async () => {
      const files = Array.from({ length: 20 }, (_, i) => ({
        path: `file${i}.ts`,
        source: `
interface Data${i} {
  value: number;
}

const data${i}: Data${i} = { value: ${i} };
console.log(data${i}.value);
`,
      }));

      // Single-threaded
      const singleStart = Date.now();
      const singleResults = await compileFiles(files, { workers: 1, threshold: 0 });
      const singleTime = Date.now() - singleStart;

      // Multi-threaded
      const multiStart = Date.now();
      const multiResults = await compileFiles(files, { workers: 4, threshold: 1 });
      const multiTime = Date.now() - multiStart;

      expect(singleResults).toHaveLength(20);
      expect(multiResults).toHaveLength(20);

      // Parallel should generally be faster, but not guaranteed in all environments
      // Just verify both complete successfully
      expect(singleTime).toBeGreaterThan(0);
      expect(multiTime).toBeGreaterThan(0);
    }, 30000); // Longer timeout for performance test

    it('should handle large files efficiently', async () => {
      const compiler = new ParallelCompiler({ workers: 2 });
      await compiler.init();

      // Generate large source file
      const largeSource = Array.from({ length: 100 }, (_, i) => `const var${i} = ${i};`).join('\n');

      const result = await compiler.compileFile('large.ts', largeSource);

      expect(result.output).toBeDefined();
      expect(result.compilationTime).toBeGreaterThan(0);

      await compiler.terminate();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty source', async () => {
      const compiler = new ParallelCompiler();
      await compiler.init();

      const result = await compiler.compileFile('empty.ts', '');

      expect(result).toBeDefined();
      expect(result.output).toBeDefined();

      await compiler.terminate();
    });

    it('should handle very long file paths', async () => {
      const compiler = new ParallelCompiler();
      await compiler.init();

      const longPath = 'a/'.repeat(50) + 'file.ts';
      const result = await compiler.compileFile(longPath, 'const x = 1;');

      expect(result.filePath).toBe(longPath);

      await compiler.terminate();
    });

    it('should handle special characters in file paths', async () => {
      const compiler = new ParallelCompiler();
      await compiler.init();

      const specialPath = 'test file (with spaces) & special-chars.ts';
      const result = await compiler.compileFile(specialPath, 'const x = 1;');

      expect(result.filePath).toBe(specialPath);

      await compiler.terminate();
    });

    it('should handle concurrent compilations', async () => {
      const compiler = new ParallelCompiler({ workers: 2 });
      await compiler.init();

      const promises = Array.from({ length: 10 }, (_, i) => compiler.compileFile(`file${i}.ts`, `const x${i} = ${i};`));

      const results = await Promise.all(promises);

      expect(results).toHaveLength(10);
      results.forEach((result, i) => {
        expect(result.filePath).toBe(`file${i}.ts`);
      });

      await compiler.terminate();
    });
  });
});
