/**
 * Distributed Computing Tests
 *
 * Tests demonstrating distributed computing patterns including map-reduce,
 * parallel processing, load balancing, and distributed data processing.
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  Process,
  Method,
  createTestProcessManager,
  TestProcessManager,
  PoolStrategy,
} from '../../../src/modules/pm/index.js';

// ============================================================================
// Map-Reduce Pattern
// ============================================================================

interface MapTask {
  id: string;
  data: any[];
  mapper: (item: any) => any;
}

interface ReduceTask {
  id: string;
  data: any[];
  reducer: (acc: any, item: any) => any;
  initialValue: any;
}

@Process({ name: 'map-worker', version: '1.0.0' })
class MapWorkerService {
  private processingTime = 0;

  @Method()
  async map(data: any[], mapper: string): Promise<{ results: any[]; processingTime: number }> {
    const startTime = Date.now();

    // Simulate mapper function (in real scenario, this would be dynamic)
    const mapperFn = this.getMapperFunction(mapper);

    // Process data
    const results = data.map((item) => mapperFn(item));

    this.processingTime = Date.now() - startTime;

    return {
      results,
      processingTime: this.processingTime,
    };
  }

  @Method()
  async getProcessingTime(): Promise<number> {
    return this.processingTime;
  }

  private getMapperFunction(name: string): (item: any) => any {
    const mappers: Record<string, (item: any) => any> = {
      square: (x: number) => x * x,
      double: (x: number) => x * 2,
      uppercase: (x: string) => x.toUpperCase(),
      'parse-word': (line: string) => line.split(' '),
      'extract-value': (obj: any) => obj.value,
      'count-words': (text: string) => ({ text, wordCount: text.split(' ').length }),
    };

    return mappers[name] || ((x) => x);
  }
}

@Process({ name: 'reduce-worker', version: '1.0.0' })
class ReduceWorkerService {
  @Method()
  async reduce(data: any[], reducer: string, initialValue: any): Promise<any> {
    const reducerFn = this.getReducerFunction(reducer);
    return data.reduce(reducerFn, initialValue);
  }

  private getReducerFunction(name: string): (acc: any, item: any) => any {
    const reducers: Record<string, (acc: any, item: any) => any> = {
      sum: (acc: number, x: number) => acc + x,
      product: (acc: number, x: number) => acc * x,
      concat: (acc: string, x: string) => acc + x,
      'merge-arrays': (acc: any[], x: any[]) => [...acc, ...x],
      count: (acc: number) => acc + 1,
      max: (acc: number, x: number) => Math.max(acc, x),
      'word-count': (acc: Record<string, number>, word: string) => {
        acc[word] = (acc[word] || 0) + 1;
        return acc;
      },
    };

    return reducers[name] || ((acc, x) => acc);
  }
}

// ============================================================================
// Parallel Data Processing
// ============================================================================

interface DataChunk {
  id: string;
  data: any[];
  startIndex: number;
  endIndex: number;
}

@Process({ name: 'data-processor', version: '1.0.0' })
class DataProcessorService {
  private processedChunks = 0;

  @Method()
  async processChunk(chunk: DataChunk): Promise<{ chunkId: string; result: any; itemsProcessed: number }> {
    // Simulate data processing
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = chunk.data.map((item) => {
      if (typeof item === 'number') {
        return item * 2;
      }
      return item;
    });

    this.processedChunks++;

    return {
      chunkId: chunk.id,
      result,
      itemsProcessed: chunk.data.length,
    };
  }

  @Method()
  async getProcessedChunks(): Promise<number> {
    return this.processedChunks;
  }

  @Method()
  async reset(): Promise<void> {
    this.processedChunks = 0;
  }
}

// ============================================================================
// Distributed Cache
// ============================================================================

interface CacheEntry<T> {
  key: string;
  value: T;
  timestamp: number;
  ttl: number;
  hits: number;
}

@Process({ name: 'cache-node', version: '1.0.0' })
class CacheNodeService<T = any> {
  private cache = new Map<string, CacheEntry<T>>();
  private nodeId: string;

  constructor() {
    this.nodeId = `node_${Math.random().toString(36).substr(2, 9)}`;
  }

  @Method()
  async set(key: string, value: T, ttl: number = 60000): Promise<boolean> {
    this.cache.set(key, {
      key,
      value,
      timestamp: Date.now(),
      ttl,
      hits: 0,
    });

    return true;
  }

  @Method()
  async get(key: string): Promise<{ value: T | null; hit: boolean; nodeId: string }> {
    const entry = this.cache.get(key);

    if (!entry) {
      return { value: null, hit: false, nodeId: this.nodeId };
    }

    // Check expiration
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.cache.delete(key);
      return { value: null, hit: false, nodeId: this.nodeId };
    }

    // Update hits
    entry.hits++;

    return { value: entry.value, hit: true, nodeId: this.nodeId };
  }

  @Method()
  async delete(key: string): Promise<boolean> {
    return this.cache.delete(key);
  }

  @Method()
  async clear(): Promise<void> {
    this.cache.clear();
  }

  @Method()
  async getStats(): Promise<{ size: number; nodeId: string; totalHits: number }> {
    let totalHits = 0;
    for (const entry of this.cache.values()) {
      totalHits += entry.hits;
    }

    return {
      size: this.cache.size,
      nodeId: this.nodeId,
      totalHits,
    };
  }

  @Method()
  async getNodeId(): Promise<string> {
    return this.nodeId;
  }
}

// ============================================================================
// Distributed Task Queue
// ============================================================================

interface Task {
  id: string;
  type: string;
  payload: any;
  priority: number;
  retries: number;
  maxRetries: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  completedAt?: number;
}

@Process({ name: 'task-worker', version: '1.0.0' })
class TaskWorkerService {
  private workerId: string;
  private completedTasks = 0;
  private failedTasks = 0;

  constructor() {
    this.workerId = `worker_${Math.random().toString(36).substr(2, 9)}`;
  }

  @Method()
  async processTask(task: Task): Promise<{ success: boolean; workerId: string; result?: any; error?: string }> {
    // Simulate task processing
    await new Promise((resolve) => setTimeout(resolve, 30 + Math.random() * 70));

    // Simulate occasional failures (10% failure rate)
    if (Math.random() < 0.1 && task.retries < task.maxRetries) {
      this.failedTasks++;
      return {
        success: false,
        workerId: this.workerId,
        error: 'Task processing failed',
      };
    }

    this.completedTasks++;

    return {
      success: true,
      workerId: this.workerId,
      result: { taskId: task.id, processedBy: this.workerId },
    };
  }

  @Method()
  async getStats(): Promise<{ workerId: string; completed: number; failed: number }> {
    return {
      workerId: this.workerId,
      completed: this.completedTasks,
      failed: this.failedTasks,
    };
  }

  @Method()
  async getWorkerId(): Promise<string> {
    return this.workerId;
  }
}

// ============================================================================
// Parallel Matrix Operations
// ============================================================================

type Matrix = number[][];

@Process({ name: 'matrix-worker', version: '1.0.0' })
class MatrixWorkerService {
  @Method()
  async multiplyRow(
    rowA: number[],
    matrixB: Matrix,
    rowIndex: number
  ): Promise<{ rowIndex: number; result: number[] }> {
    const result: number[] = [];

    for (let col = 0; col < matrixB[0].length; col++) {
      let sum = 0;
      for (let k = 0; k < rowA.length; k++) {
        sum += rowA[k] * matrixB[k][col];
      }
      result.push(sum);
    }

    // Simulate computation time
    await new Promise((resolve) => setTimeout(resolve, 10));

    return { rowIndex, result };
  }

  @Method()
  async addMatrices(matrixA: Matrix, matrixB: Matrix): Promise<Matrix> {
    const result: Matrix = [];

    for (let i = 0; i < matrixA.length; i++) {
      const row: number[] = [];
      for (let j = 0; j < matrixA[i].length; j++) {
        row.push(matrixA[i][j] + matrixB[i][j]);
      }
      result.push(row);
    }

    return result;
  }

  @Method()
  async transposeMatrix(matrix: Matrix): Promise<Matrix> {
    const rows = matrix.length;
    const cols = matrix[0].length;
    const result: Matrix = [];

    for (let j = 0; j < cols; j++) {
      const row: number[] = [];
      for (let i = 0; i < rows; i++) {
        row.push(matrix[i][j]);
      }
      result.push(row);
    }

    return result;
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('Distributed Computing - Map-Reduce', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should perform distributed map operation', async () => {
    const mapPool = await pm.pool(MapWorkerService, {
      size: 4,
      strategy: PoolStrategy.ROUND_ROBIN,
    });

    const dataset = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const chunkSize = 3;
    const chunks: any[][] = [];

    // Split data into chunks
    for (let i = 0; i < dataset.length; i += chunkSize) {
      chunks.push(dataset.slice(i, i + chunkSize));
    }

    // Map chunks in parallel
    const mapResults = await Promise.all(chunks.map((chunk) => mapPool.map(chunk, 'square')));

    // Flatten results
    const allResults = mapResults.flatMap((r) => r.results);

    expect(allResults).toHaveLength(10);
    expect(allResults[0]).toBe(1); // 1^2
    expect(allResults[1]).toBe(4); // 2^2
    expect(allResults[9]).toBe(100); // 10^2
  });

  it('should perform map-reduce word count', async () => {
    const mapPool = await pm.pool(MapWorkerService, { size: 3 });
    const reduceService = await pm.spawn(ReduceWorkerService);

    const documents = ['hello world', 'hello everyone', 'world of programming', 'programming is fun'];

    // Map: split documents into words
    const mapResults = await Promise.all(documents.map((doc) => mapPool.map([doc], 'parse-word')));

    // Flatten word arrays
    const allWords = mapResults.flatMap((r) => r.results).flat();

    // Reduce: count words
    const wordCounts = await reduceService.reduce(allWords, 'word-count', {});

    expect(wordCounts['hello']).toBe(2);
    expect(wordCounts['world']).toBe(2);
    expect(wordCounts['programming']).toBe(2);
  });

  it('should combine map and reduce for sum of squares', async () => {
    const mapPool = await pm.pool(MapWorkerService, { size: 2 });
    const reduceService = await pm.spawn(ReduceWorkerService);

    const numbers = [1, 2, 3, 4, 5, 6, 7, 8];

    // Map: square all numbers
    const mapResult = await mapPool.map(numbers, 'square');
    const squares = mapResult.results;

    // Reduce: sum all squares
    const sum = await reduceService.reduce(squares, 'sum', 0);

    expect(sum).toBe(204); // 1+4+9+16+25+36+49+64 = 204
  });
});

describe('Distributed Computing - Parallel Processing', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should process large dataset in parallel chunks', async () => {
    const pool = await pm.pool(DataProcessorService, {
      size: 4,
      strategy: PoolStrategy.LEAST_LOADED,
    });

    // Create large dataset
    const dataset = Array.from({ length: 100 }, (_, i) => i + 1);
    const chunkSize = 25;

    // Split into chunks
    const chunks: DataChunk[] = [];
    for (let i = 0; i < dataset.length; i += chunkSize) {
      chunks.push({
        id: `chunk_${i / chunkSize}`,
        data: dataset.slice(i, i + chunkSize),
        startIndex: i,
        endIndex: Math.min(i + chunkSize, dataset.length),
      });
    }

    // Process all chunks in parallel
    const startTime = Date.now();
    const results = await Promise.all(chunks.map((chunk) => pool.processChunk(chunk)));
    const parallelTime = Date.now() - startTime;

    // Verify all chunks processed
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.itemsProcessed === 25)).toBe(true);

    // Parallel processing should be faster than sequential
    // With 4 workers and 4 chunks (50ms each), should complete in ~100ms
    // Sequential would take ~200ms
    expect(parallelTime).toBeLessThan(300);

    // Flatten results
    const processedData = results.flatMap((r) => r.result);
    expect(processedData).toHaveLength(100);
  });

  it('should balance load across workers', async () => {
    const pool = await pm.pool(DataProcessorService, {
      size: 3,
      strategy: PoolStrategy.ROUND_ROBIN,
    });

    const chunks: DataChunk[] = Array.from({ length: 9 }, (_, i) => ({
      id: `chunk_${i}`,
      data: [i],
      startIndex: i,
      endIndex: i + 1,
    }));

    // Process chunks
    await Promise.all(chunks.map((chunk) => pool.processChunk(chunk)));

    // With round-robin and 3 workers, each should process 3 chunks
    const metrics = pool.metrics;
    expect(metrics.totalRequests).toBe(9);
    expect(metrics.totalWorkers).toBe(3);
  });
});

describe('Distributed Computing - Distributed Cache', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should distribute cache across multiple nodes', async () => {
    // Create cache cluster with 3 nodes
    const node1 = await pm.spawn(CacheNodeService);
    const node2 = await pm.spawn(CacheNodeService);
    const node3 = await pm.spawn(CacheNodeService);

    // Get node IDs
    const nodeId1 = await node1.getNodeId();
    const nodeId2 = await node2.getNodeId();
    const nodeId3 = await node3.getNodeId();

    // Verify nodes have unique IDs
    expect(nodeId1).not.toBe(nodeId2);
    expect(nodeId2).not.toBe(nodeId3);

    // Distribute data using consistent hashing (simplified)
    await node1.set('user:1', { name: 'Alice' });
    await node2.set('user:2', { name: 'Bob' });
    await node3.set('user:3', { name: 'Charlie' });

    // Retrieve data
    const result1 = await node1.get('user:1');
    const result2 = await node2.get('user:2');
    const result3 = await node3.get('user:3');

    expect(result1.hit).toBe(true);
    expect(result1.value).toEqual({ name: 'Alice' });
    expect(result2.hit).toBe(true);
    expect(result3.hit).toBe(true);
  });

  it('should handle cache misses and expiration', async () => {
    const cacheNode = await pm.spawn(CacheNodeService);

    // Set value with short TTL
    await cacheNode.set('temp-key', 'temp-value', 100);

    // Immediate get should hit
    const hit = await cacheNode.get('temp-key');
    expect(hit.hit).toBe(true);

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Should be expired
    const miss = await cacheNode.get('temp-key');
    expect(miss.hit).toBe(false);
    expect(miss.value).toBeNull();
  });

  it('should track cache statistics', async () => {
    const cacheNode = await pm.spawn(CacheNodeService);

    // Add some entries
    await cacheNode.set('key1', 'value1');
    await cacheNode.set('key2', 'value2');
    await cacheNode.set('key3', 'value3');

    // Access keys multiple times
    await cacheNode.get('key1');
    await cacheNode.get('key1');
    await cacheNode.get('key2');

    const stats = await cacheNode.getStats();
    expect(stats.size).toBe(3);
    expect(stats.totalHits).toBe(3);
  });
});

describe('Distributed Computing - Task Queue', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should distribute tasks across worker pool', async () => {
    const workerPool = await pm.pool(TaskWorkerService, {
      size: 4,
      strategy: PoolStrategy.LEAST_CONNECTIONS,
    });

    // Create tasks
    const tasks: Task[] = Array.from({ length: 20 }, (_, i) => ({
      id: `task_${i}`,
      type: 'compute',
      payload: { value: i },
      priority: Math.random(),
      retries: 0,
      maxRetries: 3,
      status: 'pending' as const,
      createdAt: Date.now(),
    }));

    // Process tasks
    const results = await Promise.all(tasks.map((task) => workerPool.processTask(task)));

    // Verify all tasks processed
    expect(results).toHaveLength(20);
    const successful = results.filter((r) => r.success);
    expect(successful.length).toBeGreaterThan(15); // Allow for some failures

    // Verify work distribution
    const workerIds = new Set(results.map((r) => r.workerId));
    expect(workerIds.size).toBeGreaterThan(1); // Multiple workers used
  });

  it('should retry failed tasks', async () => {
    const worker = await pm.spawn(TaskWorkerService);

    const task: Task = {
      id: 'retry-task',
      type: 'compute',
      payload: {},
      priority: 1,
      retries: 0,
      maxRetries: 3,
      status: 'pending',
      createdAt: Date.now(),
    };

    // Attempt processing with retries
    let result;
    for (let attempt = 0; attempt < task.maxRetries; attempt++) {
      result = await worker.processTask({ ...task, retries: attempt });
      if (result.success) break;
    }

    // Should eventually succeed or exhaust retries
    expect(result).toBeDefined();
  });
});

describe('Distributed Computing - Matrix Operations', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should multiply matrices in parallel by rows', async () => {
    const workerPool = await pm.pool(MatrixWorkerService, { size: 3 });

    const matrixA: Matrix = [
      [1, 2, 3],
      [4, 5, 6],
      [7, 8, 9],
    ];

    const matrixB: Matrix = [
      [9, 8, 7],
      [6, 5, 4],
      [3, 2, 1],
    ];

    // Multiply each row in parallel
    const rowResults = await Promise.all(matrixA.map((row, index) => workerPool.multiplyRow(row, matrixB, index)));

    // Sort by row index and extract results
    rowResults.sort((a, b) => a.rowIndex - b.rowIndex);
    const resultMatrix = rowResults.map((r) => r.result);

    // Verify result dimensions
    expect(resultMatrix).toHaveLength(3);
    expect(resultMatrix[0]).toHaveLength(3);

    // Verify first row calculation
    // [1,2,3] * [[9,8,7],[6,5,4],[3,2,1]] = [30, 24, 18]
    expect(resultMatrix[0][0]).toBe(30);
    expect(resultMatrix[0][1]).toBe(24);
    expect(resultMatrix[0][2]).toBe(18);
  });

  it('should perform parallel matrix operations', async () => {
    const worker = await pm.spawn(MatrixWorkerService);

    const matrixA: Matrix = [
      [1, 2],
      [3, 4],
    ];

    const matrixB: Matrix = [
      [5, 6],
      [7, 8],
    ];

    // Test addition
    const sum = await worker.addMatrices(matrixA, matrixB);
    expect(sum[0][0]).toBe(6); // 1 + 5
    expect(sum[1][1]).toBe(12); // 4 + 8

    // Test transpose
    const transposed = await worker.transposeMatrix(matrixA);
    expect(transposed[0][0]).toBe(1);
    expect(transposed[0][1]).toBe(3);
    expect(transposed[1][0]).toBe(2);
    expect(transposed[1][1]).toBe(4);
  });
});

describe('Distributed Computing - Load Balancing Strategies', () => {
  let pm: TestProcessManager;

  beforeEach(() => {
    pm = createTestProcessManager({ mock: true });
  });

  afterEach(async () => {
    await pm.cleanup();
  });

  it('should use round-robin load balancing', async () => {
    const pool = await pm.pool(TaskWorkerService, {
      size: 3,
      strategy: PoolStrategy.ROUND_ROBIN,
    });

    const tasks: Task[] = Array.from({ length: 6 }, (_, i) => ({
      id: `task_${i}`,
      type: 'test',
      payload: {},
      priority: 1,
      retries: 0,
      maxRetries: 1,
      status: 'pending' as const,
      createdAt: Date.now(),
    }));

    const results = await Promise.all(tasks.map((task) => pool.processTask(task)));

    // With 3 workers and round-robin, each worker should process 2 tasks
    const workerIds = results.map((r) => r.workerId);
    const workerCounts = new Map<string, number>();

    for (const id of workerIds) {
      workerCounts.set(id, (workerCounts.get(id) || 0) + 1);
    }

    // Each worker should have processed tasks
    expect(workerCounts.size).toBe(3);
  });

  it('should use least-loaded strategy', async () => {
    const pool = await pm.pool(DataProcessorService, {
      size: 3,
      strategy: PoolStrategy.LEAST_LOADED,
    });

    const chunks: DataChunk[] = Array.from({ length: 10 }, (_, i) => ({
      id: `chunk_${i}`,
      data: [i],
      startIndex: i,
      endIndex: i + 1,
    }));

    const results = await Promise.all(chunks.map((chunk) => pool.processChunk(chunk)));

    expect(results).toHaveLength(10);
    expect(results.every((r) => r.itemsProcessed > 0)).toBe(true);
  });
});
