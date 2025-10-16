/**
 * Tests for Engine
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createEngine } from '../../src/runtime/engine.js';
import { flow } from '@holon/flow';

describe('Engine', () => {
  let engine: ReturnType<typeof createEngine>;

  beforeEach(() => {
    engine = createEngine({
      maxConcurrency: 2,
    });
  });

  afterEach(async () => {
    await engine.shutdown();
  });

  it('should execute a simple flow', async () => {
    const add = flow((x: number) => x + 1);
    const result = await engine.execute(add, 5);

    expect(result.value).toBe(6);
    expect(result.duration).toBeGreaterThan(0);
  });

  it('should execute async flow', async () => {
    const asyncFlow = flow(async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return x * 2;
    });

    const result = await engine.execute(asyncFlow, 5);
    expect(result.value).toBe(10);
  });

  it('should handle errors', async () => {
    const errorFlow = flow(() => {
      throw new Error('Test error');
    });

    await expect(engine.execute(errorFlow, null)).rejects.toThrow('Test error');
  });

  it('should retry on failure', async () => {
    let attempts = 0;
    const retryFlow = flow(() => {
      attempts++;
      if (attempts < 3) {
        throw new Error('Retry');
      }
      return 'success';
    });

    const result = await engine.execute(retryFlow, null, {
      retry: {
        maxRetries: 3,
        delay: 10,
      },
    });

    expect(result.value).toBe('success');
    expect(attempts).toBe(3);
  });

  it('should collect metrics', async () => {
    const testFlow = flow((x: number) => x + 1);

    await engine.execute(testFlow, 5);
    await engine.execute(testFlow, 10);

    const metrics = engine.getAllMetrics();
    expect(metrics.size).toBeGreaterThan(0);
  });

  it('should execute multiple flows in parallel', async () => {
    const flows = [
      { flow: flow((x: number) => x + 1), input: 1 },
      { flow: flow((x: number) => x * 2), input: 2 },
      { flow: flow((x: number) => x - 1), input: 3 },
    ];

    const results = await engine.executeParallel(flows);

    expect(results[0].value).toBe(2);
    expect(results[1].value).toBe(4);
    expect(results[2].value).toBe(2);
  });

  it('should handle timeout', async () => {
    const slowFlow = flow(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      return 'done';
    });

    await expect(engine.execute(slowFlow, null, { timeout: 100 })).rejects.toThrow('timeout');
  });
});
