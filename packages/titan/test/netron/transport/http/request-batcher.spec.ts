/**
 * Comprehensive tests for RequestBatcher
 * Tests request batching, queuing, flushing, retries, and statistics
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RequestBatcher } from '../../../../src/netron/transport/http/request-batcher.js';
import type { HttpRequestMessage, HttpBatchResponse } from '../../../../src/netron/transport/http/types.js';

// Mock fetch globally
const mockFetch = jest.fn() as jest.MockedFunction<typeof fetch>;
global.fetch = mockFetch;

describe('RequestBatcher', () => {
  let batcher: RequestBatcher;
  const baseUrl = 'http://localhost:3000';

  // Helper to create a test request
  const createRequest = (id: string, service: string, method: string): HttpRequestMessage => ({
    id,
    version: '2.0',
    timestamp: Date.now(),
    service,
    method,
    input: { test: 'data' }
  });

  // Helper to create a successful batch response
  const createBatchResponse = (requestIds: string[]): HttpBatchResponse => ({
    id: 'batch-1',
    version: '2.0',
    timestamp: Date.now(),
    success: true,
    responses: requestIds.map(id => ({
      id,
      version: '2.0',
      timestamp: Date.now(),
      success: true,
      data: { result: `success-${id}` }
    })),
    hints: {
      successCount: requestIds.length,
      failureCount: 0
    }
  });

  // Helper to wait for a short time
  const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(async () => {
    // Wait a bit for any pending operations to complete
    await new Promise(resolve => setTimeout(resolve, 50));

    if (batcher) {
      batcher.destroy();
    }
  });

  describe('Constructor', () => {
    it('should create batcher with default options', () => {
      batcher = new RequestBatcher(baseUrl);
      expect(batcher).toBeInstanceOf(RequestBatcher);

      const stats = batcher.getStatistics();
      expect(stats.currentQueueSize).toBe(0);
      expect(stats.totalBatches).toBe(0);
    });

    it('should create batcher with custom options', () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 20,
        maxBatchWait: 50,
        maxRequestAge: 200,
        enableRetry: false,
        maxRetries: 5
      });

      expect(batcher).toBeInstanceOf(RequestBatcher);
    });

    it('should use custom headers', () => {
      batcher = new RequestBatcher(baseUrl, {
        headers: {
          'X-Custom': 'test-header',
          'Authorization': 'Bearer token'
        }
      });

      expect(batcher).toBeInstanceOf(RequestBatcher);
    });
  });

  describe('add() - Queuing', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 3,
        maxBatchWait: 20
      });
    });

    it('should queue a single request', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const requestPromise = batcher.add(createRequest('req-1', 'TestService', 'testMethod'));

      const stats = batcher.getStatistics();
      expect(stats.currentQueueSize).toBe(1);

      const result = await requestPromise;
      expect(result).toEqual({ result: 'success-req-1' });
    });

    it('should queue multiple requests', () => {
      batcher.add(createRequest('req-1', 'Service', 'method'));
      batcher.add(createRequest('req-2', 'Service', 'method'));

      const stats = batcher.getStatistics();
      expect(stats.currentQueueSize).toBe(2);
    });

    it('should emit request-queued event', async () => {
      const queuedPromise = new Promise<void>((resolve) => {
        batcher.on('request-queued', (data: any) => {
          expect(data.requestId).toBe('req-1');
          expect(data.queueSize).toBe(1);
          resolve();
        });
      });

      batcher.add(createRequest('req-1', 'Service', 'method'));

      await queuedPromise;
    });
  });

  describe('Automatic Flushing', () => {
    it('should flush immediately when batch size limit reached', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 2,
        maxBatchWait: 1000
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      // Batch should flush immediately without waiting for timer
      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ result: 'success-req-1' });
      expect(result2).toEqual({ result: 'success-req-2' });
      expect(mockFetch).toHaveBeenCalledTimes(1);

      const stats = batcher.getStatistics();
      expect(stats.totalBatches).toBe(1);
    });

    it('should flush on timer when batch size not reached', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 10,
        maxBatchWait: 20
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));
      const result = await promise;

      expect(result).toEqual({ result: 'success-req-1' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should flush on age when request gets too old', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 10,
        maxBatchWait: 1000,
        maxRequestAge: 50
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));
      const result = await promise;

      expect(result).toEqual({ result: 'success-req-1' });
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe('Batch Processing', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 5,
        maxBatchWait: 20
      });
    });

    it('should send batch request with correct format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      const promise1 = batcher.add(createRequest('req-1', 'ServiceA', 'methodA'));
      const promise2 = batcher.add(createRequest('req-2', 'ServiceB', 'methodB'));

      await Promise.all([promise1, promise2]);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/netron/batch',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'X-Netron-Version': '2.0'
          })
        })
      );

      const callArgs = mockFetch.mock.calls[0];
      const body = JSON.parse(callArgs[1]?.body as string);

      expect(body.requests).toHaveLength(2);
      expect(body.requests[0].id).toBe('req-1');
      expect(body.requests[1].id).toBe('req-2');
      expect(body.options).toEqual({
        parallel: true,
        stopOnError: false
      });
    });

    it('should resolve promises with correct data', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      const [result1, result2] = await Promise.all([promise1, promise2]);

      expect(result1).toEqual({ result: 'success-req-1' });
      expect(result2).toEqual({ result: 'success-req-2' });
    });

    it('should emit batch-start event', async () => {
      const startPromise = new Promise<void>((resolve) => {
        batcher.on('batch-start', (data: any) => {
          expect(data.size).toBeGreaterThan(0);
          expect(data.reason).toBeDefined();
          expect(data.batchId).toBeDefined();
          resolve();
        });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      batcher.add(createRequest('req-1', 'Service', 'method'));

      await startPromise;
    });

    it('should emit batch-complete event', async () => {
      const completePromise = new Promise<void>((resolve) => {
        batcher.on('batch-complete', (data: any) => {
          expect(data.size).toBeGreaterThan(0);
          expect(data.latency).toBeGreaterThanOrEqual(0);
          resolve();
        });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      batcher.add(createRequest('req-1', 'Service', 'method'));

      await completePromise;
    });

    it('should emit request-success event', async () => {
      const successPromise = new Promise<void>((resolve) => {
        batcher.on('request-success', (data: any) => {
          expect(data.requestId).toBe('req-1');
          expect(data.latency).toBeGreaterThanOrEqual(0);
          resolve();
        });
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      batcher.add(createRequest('req-1', 'Service', 'method'));

      await successPromise;
    });
  });

  describe('Error Handling', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 5,
        maxBatchWait: 20,
        enableRetry: false
      });
    });

    it('should reject promise on request failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [{
            id: 'req-1',
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: {
              code: 'SERVICE_ERROR',
              message: 'Service failed'
            }
          }]
        })
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      await expect(promise).rejects.toThrow('Service failed');
    });

    it('should reject all promises on network error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      await expect(promise1).rejects.toThrow('Network error');
      await expect(promise2).rejects.toThrow('Network error');
    });

    it('should emit batch-error event on failure', async () => {
      mockFetch.mockRejectedValue(new Error('Batch failed'));

      const errorPromise = new Promise<void>((resolve) => {
        batcher.on('batch-error', (data: any) => {
          expect(data.error).toBe('Batch failed');
          expect(data.size).toBeGreaterThan(0);
          resolve();
        });
      });

      batcher.add(createRequest('req-1', 'Service', 'method')).catch(() => {});

      await errorPromise;
    });

    it('should emit request-failure event on individual failure', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [{
            id: 'req-1',
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: {
              code: 'ERROR',
              message: 'Failed'
            }
          }]
        })
      } as Response);

      const failurePromise = new Promise<void>((resolve) => {
        batcher.on('request-failure', (data: any) => {
          expect(data.requestId).toBe('req-1');
          expect(data.error).toBeDefined();
          resolve();
        });
      });

      batcher.add(createRequest('req-1', 'Service', 'method')).catch(() => {});

      await failurePromise;
    });

    it('should handle HTTP error responses', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error'
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      await expect(promise).rejects.toThrow('Batch request failed: 500 Internal Server Error');
    });
  });

  describe('Retry Logic', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 5,
        maxBatchWait: 20,
        enableRetry: true,
        maxRetries: 2
      });
    });

    it('should retry failed requests', async () => {
      // First attempt fails
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [{
            id: 'req-1',
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'TEMP_ERROR', message: 'Temporary failure' }
          }]
        })
      } as Response);

      // Second attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));
      const result = await promise;

      expect(result).toEqual({ result: 'success-req-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);

      const stats = batcher.getStatistics();
      expect(stats.retriedRequests).toBe(1);
    });

    it('should emit request-retry event', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [{
            id: 'req-1',
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'ERROR', message: 'Failed' }
          }]
        })
      } as Response);

      const retryPromise = new Promise<void>((resolve) => {
        batcher.on('request-retry', (data: any) => {
          expect(data.requestId).toBe('req-1');
          expect(data.attempt).toBe(1);
          expect(data.error).toBeDefined();
          resolve();
        });
      });

      batcher.add(createRequest('req-1', 'Service', 'method')).catch(() => {});

      await retryPromise;
    });

    it('should give up after max retries', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [{
            id: 'req-1',
            version: '2.0',
            timestamp: Date.now(),
            success: false,
            error: { code: 'ERROR', message: 'Persistent failure' }
          }]
        })
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      await expect(promise).rejects.toThrow('Persistent failure');
      expect(mockFetch).toHaveBeenCalledTimes(3); // 1 original + 2 retries
    });

    it('should retry on network errors', async () => {
      // First two attempts fail with network error
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      // Third attempt succeeds
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));
      const result = await promise;

      expect(result).toEqual({ result: 'success-req-1' });
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });
  });

  describe('Statistics', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 5,
        maxBatchWait: 20
      });
    });

    it('should track batch statistics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      await Promise.all([promise1, promise2]);

      const stats = batcher.getStatistics();

      expect(stats.totalBatches).toBe(1);
      expect(stats.totalRequests).toBe(2);
      expect(stats.successfulRequests).toBe(2);
      expect(stats.failedRequests).toBe(0);
      expect(stats.averageBatchSize).toBe(2);
      expect(stats.averageLatency).toBeGreaterThanOrEqual(0);
      expect(stats.currentQueueSize).toBe(0);
    });

    it('should track failed requests', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'batch-1',
          version: '2.0',
          timestamp: Date.now(),
          success: true,
          responses: [
            {
              id: 'req-1',
              version: '2.0',
              timestamp: Date.now(),
              success: true,
              data: { result: 'success' }
            },
            {
              id: 'req-2',
              version: '2.0',
              timestamp: Date.now(),
              success: false,
              error: { code: 'ERROR', message: 'Failed' }
            }
          ]
        })
      } as Response);

      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 5,
        maxBatchWait: 20,
        enableRetry: false
      });

      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      await promise1;
      await expect(promise2).rejects.toThrow();

      const stats = batcher.getStatistics();
      expect(stats.successfulRequests).toBe(1);
      expect(stats.failedRequests).toBe(1);
    });

    it('should reset statistics', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      await batcher.add(createRequest('req-1', 'Service', 'method'));

      batcher.resetStatistics();

      const stats = batcher.getStatistics();
      expect(stats.totalBatches).toBe(0);
      expect(stats.totalRequests).toBe(0);
      expect(stats.successfulRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
      expect(stats.retriedRequests).toBe(0);
    });

    it('should maintain rolling average of batch sizes', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      // First batch with 2 requests
      await Promise.all([
        batcher.add(createRequest('req-1', 'Service', 'method')),
        batcher.add(createRequest('req-2', 'Service', 'method'))
      ]);

      // Second batch with 1 request
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-3'])
      } as Response);

      await batcher.add(createRequest('req-3', 'Service', 'method'));

      const stats = batcher.getStatistics();
      expect(stats.averageBatchSize).toBe(1.5); // (2 + 1) / 2
    });
  });

  describe('Manual Operations', () => {
    beforeEach(() => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 10,
        maxBatchWait: 1000
      });
    });

    it('should support manual flush', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response);

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      // Manually flush before timer expires
      await batcher.flush('manual');
      const result = await promise;

      expect(result).toEqual({ result: 'success-req-1' });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should not flush if queue is empty', async () => {
      await batcher.flush('manual');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should not flush if already processing', async () => {
      mockFetch.mockImplementation(() => new Promise(resolve => setTimeout(() => resolve({
        ok: true,
        json: async () => createBatchResponse(['req-1'])
      } as Response), 50)));

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      // Try to flush while still processing
      await batcher.flush('manual');
      await batcher.flush('manual');

      await promise;

      // Should only call fetch once
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should update configuration at runtime', () => {
      batcher.setConfiguration({
        maxBatchSize: 20,
        maxBatchWait: 200,
        maxRequestAge: 300
      });

      // Configuration change is successful (no error thrown)
      expect(batcher).toBeDefined();
    });
  });

  describe('Cleanup', () => {
    it('should destroy batcher and reject pending requests', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 10,
        maxBatchWait: 1000
      });

      const promise = batcher.add(createRequest('req-1', 'Service', 'method'));

      batcher.destroy();

      await expect(promise).rejects.toThrow(/Batcher.*destroyed/i);
    });

    it('should clear all timers on destroy', () => {
      batcher = new RequestBatcher(baseUrl);

      batcher.destroy();

      const stats = batcher.getStatistics();
      expect(stats.currentQueueSize).toBe(0);
    });

    it('should remove all event listeners on destroy', () => {
      batcher = new RequestBatcher(baseUrl);

      const listener = jest.fn();
      batcher.on('batch-start', listener);

      batcher.destroy();

      // Should not throw or call listener after destroy
      expect(() => {
        mockFetch.mockResolvedValue({
          ok: true,
          json: async () => createBatchResponse(['req-1'])
        } as Response);
        batcher.add(createRequest('req-1', 'Service', 'method'));
      }).not.toThrow();
    });
  });

  describe('Multiple Batches', () => {
    it('should process multiple batches sequentially', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 2,
        maxBatchWait: 20
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      // First batch
      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));

      await Promise.all([promise1, promise2]);

      // Second batch
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-3', 'req-4'])
      } as Response);

      const promise3 = batcher.add(createRequest('req-3', 'Service', 'method'));
      const promise4 = batcher.add(createRequest('req-4', 'Service', 'method'));

      await Promise.all([promise3, promise4]);

      expect(mockFetch).toHaveBeenCalledTimes(2);

      const stats = batcher.getStatistics();
      expect(stats.totalBatches).toBe(2);
      expect(stats.totalRequests).toBe(4);
    });

    it('should queue remaining requests after flush', async () => {
      batcher = new RequestBatcher(baseUrl, {
        maxBatchSize: 2,
        maxBatchWait: 20
      });

      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-1', 'req-2'])
      } as Response);

      // Add 3 requests - first 2 should flush immediately
      const promise1 = batcher.add(createRequest('req-1', 'Service', 'method'));
      const promise2 = batcher.add(createRequest('req-2', 'Service', 'method'));
      const promise3 = batcher.add(createRequest('req-3', 'Service', 'method'));

      await Promise.all([promise1, promise2]);

      // Third request should still be queued
      let stats = batcher.getStatistics();
      expect(stats.currentQueueSize).toBe(1);

      // Wait for second batch
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => createBatchResponse(['req-3'])
      } as Response);

      await promise3;

      stats = batcher.getStatistics();
      expect(stats.totalBatches).toBe(2);
    });
  });
});
