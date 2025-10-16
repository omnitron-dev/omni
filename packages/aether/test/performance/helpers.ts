/**
 * Performance testing helpers
 *
 * Provides utilities for performance benchmarks and tests
 */

import { Schema, DOMParser, Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';

/**
 * Benchmark result
 */
export interface BenchmarkResult {
  name: string;
  samples: number;
  mean: number;
  median: number;
  p95: number;
  p99: number;
  min: number;
  max: number;
  stddev: number;
}

/**
 * Run a benchmark
 */
export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  options: {
    samples?: number;
    warmup?: number;
    timeout?: number;
  } = {}
): Promise<BenchmarkResult> {
  const { samples = 100, warmup = 10, timeout = 30000 } = options;

  const timings: number[] = [];
  const startTime = Date.now();

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();

    if (Date.now() - startTime > timeout) {
      throw new Error(`Benchmark "${name}" timed out during warmup`);
    }
  }

  // Run samples
  for (let i = 0; i < samples; i++) {
    const start = performance.now();
    await fn();
    const end = performance.now();

    timings.push(end - start);

    if (Date.now() - startTime > timeout) {
      throw new Error(`Benchmark "${name}" timed out`);
    }
  }

  // Calculate statistics
  const sorted = timings.slice().sort((a, b) => a - b);
  const mean = timings.reduce((sum, t) => sum + t, 0) / timings.length;
  const median = sorted[Math.floor(sorted.length / 2)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const p99 = sorted[Math.floor(sorted.length * 0.99)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];

  // Standard deviation
  const variance = timings.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / timings.length;
  const stddev = Math.sqrt(variance);

  return {
    name,
    samples: timings.length,
    mean,
    median,
    p95,
    p99,
    min,
    max,
    stddev,
  };
}

/**
 * Generate a mock document of specified size
 */
export function generateMockDocument(sizeKB: number): string {
  const targetSize = sizeKB * 1024;
  const paragraphs: string[] = [];

  const loremIpsum = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.`;

  let currentSize = 0;

  while (currentSize < targetSize) {
    paragraphs.push(loremIpsum);
    currentSize += loremIpsum.length;
  }

  return paragraphs.join('\n\n');
}

/**
 * Generate a large document with headings and lists
 */
export function generateStructuredDocument(sizeKB: number): string {
  const targetSize = sizeKB * 1024;
  const sections: string[] = [];

  const paragraph = `Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.`;

  let currentSize = 0;
  let sectionNum = 1;

  while (currentSize < targetSize) {
    // Add heading
    const heading = `# Section ${sectionNum}`;
    sections.push(heading);
    currentSize += heading.length;

    // Add paragraphs
    for (let i = 0; i < 3; i++) {
      sections.push(paragraph);
      currentSize += paragraph.length;
    }

    // Add list
    const list = `- Item 1\n- Item 2\n- Item 3`;
    sections.push(list);
    currentSize += list.length;

    sectionNum++;
  }

  return sections.join('\n\n');
}

/**
 * Create a ProseMirror document from text
 */
export function createDocFromText(schema: Schema, text: string): ProseMirrorNode {
  const lines = text.split('\n\n');
  const paragraphs = lines.map((line) =>
    schema.nodes.paragraph.create(null, line ? schema.text(line) : null)
  );

  return schema.nodes.doc.create(null, paragraphs);
}

/**
 * Create a mock editor state
 */
export function createMockEditorState(schema: Schema, content?: string): EditorState {
  const doc = content ? createDocFromText(schema, content) : schema.nodes.doc.create(null, [
    schema.nodes.paragraph.create(),
  ]);

  return EditorState.create({
    doc,
    schema,
  });
}

/**
 * Create a mock editor view
 */
export function createMockEditorView(state: EditorState): EditorView {
  const container = document.createElement('div');
  document.body.appendChild(container);

  return new EditorView(container, {
    state,
  });
}

/**
 * Cleanup editor view
 */
export function cleanupEditorView(view: EditorView): void {
  view.destroy();
  if (view.dom.parentNode) {
    view.dom.parentNode.removeChild(view.dom);
  }
}

/**
 * Measure memory usage
 */
export function measureMemory(): {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
} | null {
  if (typeof performance === 'undefined' || !(performance as any).memory) {
    return null;
  }

  const memory = (performance as any).memory;
  return {
    usedJSHeapSize: memory.usedJSHeapSize,
    totalJSHeapSize: memory.totalJSHeapSize,
    jsHeapSizeLimit: memory.jsHeapSizeLimit,
  };
}

/**
 * Wait for idle callback
 */
export function waitForIdle(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(() => resolve());
    } else {
      setTimeout(resolve, 0);
    }
  });
}

/**
 * Wait for animation frame
 */
export function waitForFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

/**
 * Format benchmark result
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  const lines: string[] = [
    `Benchmark: ${result.name}`,
    `Samples: ${result.samples}`,
    `Mean: ${result.mean.toFixed(2)}ms`,
    `Median: ${result.median.toFixed(2)}ms`,
    `P95: ${result.p95.toFixed(2)}ms`,
    `P99: ${result.p99.toFixed(2)}ms`,
    `Min: ${result.min.toFixed(2)}ms`,
    `Max: ${result.max.toFixed(2)}ms`,
    `StdDev: ${result.stddev.toFixed(2)}ms`,
  ];

  return lines.join('\n');
}

/**
 * Assert benchmark passes budget
 */
export function assertBenchmarkBudget(
  result: BenchmarkResult,
  budget: number,
  metric: 'mean' | 'median' | 'p95' | 'p99' = 'p95'
): void {
  const value = result[metric];

  if (value > budget) {
    throw new Error(
      `Benchmark "${result.name}" exceeded budget: ${value.toFixed(2)}ms > ${budget}ms (${metric})`
    );
  }
}

/**
 * Compare two benchmark results
 */
export function compareBenchmarks(
  baseline: BenchmarkResult,
  current: BenchmarkResult
): {
  name: string;
  metric: string;
  baseline: number;
  current: number;
  change: number;
  changePercent: number;
  improved: boolean;
} {
  const metrics = ['mean', 'median', 'p95', 'p99'] as const;
  const results: any[] = [];

  for (const metric of metrics) {
    const baselineValue = baseline[metric];
    const currentValue = current[metric];
    const change = currentValue - baselineValue;
    const changePercent = (change / baselineValue) * 100;

    results.push({
      name: baseline.name,
      metric,
      baseline: baselineValue,
      current: currentValue,
      change,
      changePercent,
      improved: change < 0,
    });
  }

  // Return most significant change
  return results.reduce((max, r) =>
    Math.abs(r.changePercent) > Math.abs(max.changePercent) ? r : max
  );
}

/**
 * Save benchmark results to file
 */
export async function saveBenchmarkResults(
  results: BenchmarkResult[],
  filename: string
): Promise<void> {
  const data = {
    timestamp: new Date().toISOString(),
    results,
  };

  if (typeof Bun !== 'undefined') {
    await Bun.write(filename, JSON.stringify(data, null, 2));
  } else if (typeof require !== 'undefined') {
    const fs = require('fs');
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
  }
}

/**
 * Load benchmark results from file
 */
export async function loadBenchmarkResults(filename: string): Promise<{
  timestamp: string;
  results: BenchmarkResult[];
} | null> {
  try {
    if (typeof Bun !== 'undefined') {
      const file = Bun.file(filename);
      const text = await file.text();
      return JSON.parse(text);
    } else if (typeof require !== 'undefined') {
      const fs = require('fs');
      const text = fs.readFileSync(filename, 'utf-8');
      return JSON.parse(text);
    }
  } catch {
    return null;
  }

  return null;
}
