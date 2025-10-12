/**
 * Example: Image Processing Worker
 *
 * This example demonstrates a CPU-intensive image processing service
 * that would benefit from running in a separate process or pool.
 */

import { Process, Public, HealthCheck, Metric, Trace } from '../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../src/modules/pm/types.js';

interface ImageJob {
  id: string;
  url: string;
  operations: ImageOperation[];
}

interface ImageOperation {
  type: 'resize' | 'crop' | 'rotate' | 'filter' | 'compress';
  params: any;
}

interface ProcessedImage {
  jobId: string;
  originalUrl: string;
  processedUrl: string;
  operations: ImageOperation[];
  processingTime: number;
  size: { width: number; height: number };
}

/**
 * Image processing service for CPU-intensive image transformations
 */
@Process({
  name: 'image-processor',
  version: '1.0.0',
  memory: {
    limit: '512MB',
    alert: '400MB',
  },
  observability: {
    metrics: true,
    tracing: true,
  },
})
export default class ImageProcessorProcess {
  private processedCount = 0;
  private totalProcessingTime = 0;
  private currentLoad = 0;
  private errors = 0;

  @Public()
  @Trace()
  @Metric()
  async processImage(job: ImageJob): Promise<ProcessedImage> {
    const startTime = Date.now();
    this.currentLoad++;

    try {
      // Validate job
      if (!job.id || !job.url) {
        throw new Error('Invalid job: missing id or url');
      }

      // Simulate loading image
      await this.simulateWork(50);

      // Process each operation
      let processedData = await this.loadImage(job.url);

      for (const operation of job.operations) {
        processedData = await this.applyOperation(processedData, operation);
      }

      // Simulate saving processed image
      await this.simulateWork(30);

      const processingTime = Date.now() - startTime;
      this.processedCount++;
      this.totalProcessingTime += processingTime;

      return {
        jobId: job.id,
        originalUrl: job.url,
        processedUrl: `processed/${job.id}.jpg`,
        operations: job.operations,
        processingTime,
        size: processedData.size,
      };
    } catch (error) {
      this.errors++;
      throw error;
    } finally {
      this.currentLoad--;
    }
  }

  @Public()
  async processBatch(jobs: ImageJob[]): Promise<ProcessedImage[]> {
    // Process images in parallel with concurrency limit
    const concurrency = 3;
    const results: ProcessedImage[] = [];

    for (let i = 0; i < jobs.length; i += concurrency) {
      const batch = jobs.slice(i, i + concurrency);
      const batchResults = await Promise.all(batch.map((job) => this.processImage(job)));
      results.push(...batchResults);
    }

    return results;
  }

  @Public()
  async generateThumbnail(url: string, width: number = 150, height: number = 150): Promise<ProcessedImage> {
    const job: ImageJob = {
      id: `thumb_${Date.now()}`,
      url,
      operations: [
        {
          type: 'resize',
          params: { width, height, maintainAspectRatio: true },
        },
        {
          type: 'compress',
          params: { quality: 85 },
        },
      ],
    };

    return this.processImage(job);
  }

  @Public()
  async applyFilter(url: string, filterType: string): Promise<ProcessedImage> {
    const job: ImageJob = {
      id: `filter_${Date.now()}`,
      url,
      operations: [
        {
          type: 'filter',
          params: { type: filterType },
        },
      ],
    };

    return this.processImage(job);
  }

  @Public()
  async getStats(): Promise<{
    processedCount: number;
    averageProcessingTime: number;
    currentLoad: number;
    errorRate: number;
  }> {
    return {
      processedCount: this.processedCount,
      averageProcessingTime: this.processedCount > 0 ? this.totalProcessingTime / this.processedCount : 0,
      currentLoad: this.currentLoad,
      errorRate: this.processedCount > 0 ? this.errors / (this.processedCount + this.errors) : 0,
    };
  }

  private async loadImage(url: string): Promise<{ data: any; size: { width: number; height: number } }> {
    // Simulate loading image from URL
    await this.simulateWork(100);

    return {
      data: { url, loaded: true },
      size: { width: 1920, height: 1080 },
    };
  }

  private async applyOperation(
    imageData: any,
    operation: ImageOperation
  ): Promise<{ data: any; size: { width: number; height: number } }> {
    // Simulate applying image operation
    switch (operation.type) {
      case 'resize':
        await this.simulateWork(150);
        return {
          data: { ...imageData.data, resized: true },
          size: {
            width: operation.params.width || imageData.size.width,
            height: operation.params.height || imageData.size.height,
          },
        };

      case 'crop':
        await this.simulateWork(100);
        return {
          data: { ...imageData.data, cropped: true },
          size: {
            width: operation.params.width || imageData.size.width,
            height: operation.params.height || imageData.size.height,
          },
        };

      case 'rotate':
        await this.simulateWork(120);
        return {
          data: { ...imageData.data, rotated: operation.params.angle },
          size: imageData.size,
        };

      case 'filter':
        await this.simulateWork(200);
        return {
          data: { ...imageData.data, filter: operation.params.type },
          size: imageData.size,
        };

      case 'compress':
        await this.simulateWork(80);
        return {
          data: { ...imageData.data, compressed: operation.params.quality },
          size: imageData.size,
        };

      default:
        return imageData;
    }
  }

  private async simulateWork(ms: number): Promise<void> {
    // Simulate CPU-intensive work
    const start = Date.now();
    while (Date.now() - start < ms) {
      // Busy wait to simulate CPU load
      Math.sqrt(Math.random());
    }
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    const memoryUsage = process.memoryUsage();
    const stats = await this.getStats();

    const checks = [];

    // Check memory usage
    const memoryMB = memoryUsage.heapUsed / 1024 / 1024;
    if (memoryMB > 400) {
      checks.push({
        name: 'memory',
        status: 'warn' as const,
        message: `High memory usage: ${memoryMB.toFixed(2)}MB`,
      });
    } else {
      checks.push({
        name: 'memory',
        status: 'pass' as const,
        message: `Memory usage: ${memoryMB.toFixed(2)}MB`,
      });
    }

    // Check load
    if (this.currentLoad > 10) {
      checks.push({
        name: 'load',
        status: 'warn' as const,
        message: `High load: ${this.currentLoad} concurrent operations`,
      });
    } else {
      checks.push({
        name: 'load',
        status: 'pass' as const,
        message: `Current load: ${this.currentLoad}`,
      });
    }

    // Check error rate
    if (stats.errorRate > 0.1) {
      checks.push({
        name: 'errors',
        status: 'warn' as const,
        message: `High error rate: ${(stats.errorRate * 100).toFixed(2)}%`,
      });
    }

    const hasWarning = checks.some((c) => c.status === 'warn');

    return {
      status: hasWarning ? 'degraded' : 'healthy',
      checks,
      timestamp: Date.now(),
    };
  }
}
