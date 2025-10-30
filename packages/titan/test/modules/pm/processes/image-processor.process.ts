/**
 * Image Processor Service Process
 * Used in real-world scenario tests for image processing pipeline
 */

import { Process, Method, HealthCheck, OnShutdown } from '../../../../src/modules/pm/decorators.js';
import type { IHealthStatus } from '../../../../src/modules/pm/types.js';

interface ImageJob {
  id: string;
  url: string;
  transformations: Array<'resize' | 'crop' | 'filter' | 'compress'>;
  priority: 'low' | 'normal' | 'high';
}

@Process({ name: 'image-processor', version: '1.0.0' })
export default class ImageProcessorService {
  private processedCount = 0;

  @Method()
  async processImage(job: ImageJob): Promise<{ success: boolean; outputUrl: string; processingTime: number }> {
    const startTime = Date.now();

    // Simulate image processing based on transformations
    const processingTime = job.transformations.length * 50;
    await new Promise((resolve) => setTimeout(resolve, processingTime));

    this.processedCount++;

    return {
      success: true,
      outputUrl: `processed/${job.id}.jpg`,
      processingTime: Date.now() - startTime,
    };
  }

  @Method()
  async getProcessedCount(): Promise<number> {
    return this.processedCount;
  }

  @HealthCheck()
  async checkHealth(): Promise<IHealthStatus> {
    return {
      status: this.processedCount < 1000 ? 'healthy' : 'degraded',
      checks: [{ name: 'processor', status: 'pass', message: `${this.processedCount} images processed` }],
      timestamp: Date.now(),
    };
  }

  @OnShutdown()
  async cleanup(): Promise<void> {
    // Cleanup resources
    this.processedCount = 0;
  }
}
