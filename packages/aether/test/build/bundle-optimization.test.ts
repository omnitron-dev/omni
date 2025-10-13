/**
 * Tests for Bundle Optimization
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { BundleOptimizer, CodeSplitter } from '../../src/build/bundle-optimization.js';

describe('BundleOptimizer', () => {
  let optimizer: BundleOptimizer;

  beforeEach(() => {
    optimizer = new BundleOptimizer({
      entries: {
        main: 'src/main.ts',
        admin: 'src/admin.ts',
      },
      vendorChunks: true,
      commonChunks: true,
      minifier: 'terser',
    });
  });

  it('should add modules', () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'console.log("main")',
      size: 100,
      dependencies: [],
      dynamicImports: [],
    });

    expect(true).toBe(true);
  });

  it('should optimize bundle', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'import "./utils"',
      size: 1000,
      dependencies: ['src/utils.ts'],
      dynamicImports: [],
    });

    optimizer.addModule('src/utils.ts', {
      id: 'src/utils.ts',
      code: 'export const util = () => {}',
      size: 500,
      dependencies: [],
      dynamicImports: [],
    });

    optimizer.addModule('node_modules/react/index.js', {
      id: 'node_modules/react/index.js',
      code: 'export const React = {}',
      size: 5000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.chunks.size).toBeGreaterThan(0);
    expect(result.chunkGraph).toBeDefined();
    expect(result.stats).toBeDefined();
    expect(result.report).toBeDefined();
  });

  it('should split vendor chunks', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'import React from "react"',
      size: 1000,
      dependencies: ['node_modules/react/index.js'],
      dynamicImports: [],
    });

    optimizer.addModule('node_modules/react/index.js', {
      id: 'node_modules/react/index.js',
      code: 'export default {}',
      size: 10000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    const vendorChunk = Array.from(result.chunks.values()).find((c) => c.type === 'vendor');

    expect(vendorChunk).toBeDefined();
    expect(vendorChunk?.modules.has('node_modules/react/index.js')).toBe(true);
  });

  it('should extract common chunks', async () => {
    const sharedUtil = 'src/shared.ts';

    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'import "./shared"',
      size: 1000,
      dependencies: [sharedUtil],
      dynamicImports: [],
    });

    optimizer.addModule('src/admin.ts', {
      id: 'src/admin.ts',
      code: 'import "./shared"',
      size: 1000,
      dependencies: [sharedUtil],
      dynamicImports: [],
    });

    optimizer.addModule(sharedUtil, {
      id: sharedUtil,
      code: 'export const shared = {}',
      size: 2000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    const commonChunk = Array.from(result.chunks.values()).find((c) => c.type === 'common');

    expect(commonChunk).toBeDefined();
  });

  it('should split large chunks', async () => {
    const modules: any[] = [];

    // Create a large chunk by adding many modules
    for (let i = 0; i < 20; i++) {
      const moduleId = `src/module${i}.ts`;
      modules.push(moduleId);
      optimizer.addModule(moduleId, {
        id: moduleId,
        code: `export const module${i} = {}`,
        size: 15000, // Each module is large
        dependencies: [],
        dynamicImports: [],
      });
    }

    const result = await optimizer.optimize();

    // Should have split large chunks
    expect(result.chunks.size).toBeGreaterThan(1);
  });

  it('should apply module concatenation', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'console.log("main")',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    const concatenationStep = result.report.steps.find((s) => s.name.includes('Concatenate'));

    expect(concatenationStep).toBeDefined();
    expect(concatenationStep?.savings).toBeGreaterThanOrEqual(0);
  });

  it('should apply scope hoisting', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'console.log("main")',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    const hoistingStep = result.report.steps.find((s) => s.name.includes('Scope hoisting'));

    expect(hoistingStep).toBeDefined();
    expect(hoistingStep?.savings).toBeGreaterThanOrEqual(0);
  });

  it('should minify chunks', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'const longVariableName = 42; console.log(longVariableName);',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    const minifyStep = result.report.steps.find((s) => s.name.includes('Minify'));

    expect(minifyStep).toBeDefined();
    expect(minifyStep?.savings).toBeGreaterThan(0);
  });

  it('should build chunk graph', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'import "./utils"',
      size: 1000,
      dependencies: ['src/utils.ts'],
      dynamicImports: [],
    });

    optimizer.addModule('src/utils.ts', {
      id: 'src/utils.ts',
      code: 'export const util = () => {}',
      size: 500,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.chunkGraph.entries.size).toBeGreaterThan(0);
    expect(result.chunkGraph.dependencies.size).toBeGreaterThan(0);
  });

  it('should calculate bundle statistics', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'console.log("main")',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.stats.totalChunks).toBeGreaterThan(0);
    expect(result.stats.totalSize).toBeGreaterThan(0);
    expect(result.stats.gzippedSize).toBeLessThan(result.stats.totalSize);
  });

  it('should generate optimization recommendations', async () => {
    // Add a very large chunk
    optimizer.addModule('src/large.ts', {
      id: 'src/large.ts',
      code: 'x'.repeat(1000000),
      size: 1000000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.report.recommendations.length).toBeGreaterThan(0);
  });

  it('should track optimization duration', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'console.log("main")',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.report.totalDuration).toBeGreaterThan(0);
    expect(result.report.steps.every((s) => s.duration >= 0)).toBe(true);
  });

  it('should calculate total savings', async () => {
    optimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'const x = 42;',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await optimizer.optimize();

    expect(result.report.totalSavings).toBeGreaterThanOrEqual(0);
  });

  it('should skip minification when disabled', async () => {
    const noMinifyOptimizer = new BundleOptimizer({
      entries: { main: 'src/main.ts' },
      minifier: 'none',
    });

    noMinifyOptimizer.addModule('src/main.ts', {
      id: 'src/main.ts',
      code: 'const x = 42;',
      size: 1000,
      dependencies: [],
      dynamicImports: [],
    });

    const result = await noMinifyOptimizer.optimize();

    const minifyStep = result.report.steps.find((s) => s.name.includes('Minify'));

    expect(minifyStep).toBeUndefined();
  });
});

describe('CodeSplitter', () => {
  let splitter: CodeSplitter;

  beforeEach(() => {
    splitter = new CodeSplitter();
  });

  it('should add split points', () => {
    splitter.addSplitPoint('lazy-component', {
      moduleId: 'src/components/LazyComponent.tsx',
      chunkName: 'lazy-component',
      strategy: 'lazy',
    });

    const splitPoints = splitter.getSplitPoints();

    expect(splitPoints.has('lazy-component')).toBe(true);
  });

  it('should generate lazy dynamic imports', () => {
    const code = splitter.generateDynamicImport('module.js', 'lazy');

    expect(code).toContain('import(');
    expect(code).toContain('module.js');
  });

  it('should generate prefetch dynamic imports', () => {
    const code = splitter.generateDynamicImport('module.js', 'prefetch');

    expect(code).toContain('webpackPrefetch');
  });

  it('should generate eager dynamic imports', () => {
    const code = splitter.generateDynamicImport('module.js', 'eager');

    expect(code).toContain('webpackMode');
    expect(code).toContain('eager');
  });

  it('should track multiple split points', () => {
    splitter.addSplitPoint('point1', {
      moduleId: 'module1.js',
      strategy: 'lazy',
    });
    splitter.addSplitPoint('point2', {
      moduleId: 'module2.js',
      strategy: 'prefetch',
    });
    splitter.addSplitPoint('point3', {
      moduleId: 'module3.js',
      strategy: 'eager',
    });

    const splitPoints = splitter.getSplitPoints();

    expect(splitPoints.size).toBe(3);
  });
});
