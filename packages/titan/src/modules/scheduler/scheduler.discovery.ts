/**
 * Scheduler Discovery Service
 *
 * Discovers and registers scheduled jobs from decorated classes
 */

import { Inject, Optional, Container, Injectable } from '@omnitron-dev/nexus';

import { getScheduledJobs } from './scheduler.decorators';
import {
  SCHEDULER_METADATA,
  SCHEDULER_CONFIG_TOKEN,
  SCHEDULER_REGISTRY_TOKEN
} from './scheduler.constants';

import type { SchedulerRegistry } from './scheduler.registry';
import type {
  JobMetadata,
  ScheduledJob,
  SchedulerConfig
} from './scheduler.interfaces';

/**
 * Discovers scheduled jobs in the application
 */
@Injectable()
export class SchedulerDiscovery {
  private discoveredProviders = new Set<any>();

  constructor(
    @Inject(Container) private readonly container: Container,
    @Inject(SCHEDULER_REGISTRY_TOKEN) private readonly registry: SchedulerRegistry,
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: SchedulerConfig
  ) {}

  /**
   * Discover and register all scheduled jobs
   */
  async discover(): Promise<ScheduledJob[]> {
    const jobs: ScheduledJob[] = [];

    // Get all providers from container
    const providers = this.getAllProviders();

    for (const provider of providers) {
      const providerJobs = await this.discoverProviderJobs(provider);
      jobs.push(...providerJobs);
    }

    return jobs;
  }

  /**
   * Discover jobs in a specific provider
   */
  async discoverProviderJobs(provider: any): Promise<ScheduledJob[]> {
    if (!provider || typeof provider !== 'object') {
      return [];
    }

    // Check if already discovered
    if (this.discoveredProviders.has(provider)) {
      return [];
    }
    this.discoveredProviders.add(provider);

    const jobs: ScheduledJob[] = [];
    const constructor = provider.constructor;

    // Get scheduled jobs metadata
    const scheduledJobs = getScheduledJobs(constructor);

    for (const { propertyKey, metadata } of scheduledJobs) {
      const job = this.registerJob(provider, propertyKey.toString(), metadata);
      if (job) {
        jobs.push(job);
      }
    }

    return jobs;
  }

  /**
   * Register a scheduled job
   */
  private registerJob(
    instance: any,
    methodName: string,
    metadata: JobMetadata
  ): ScheduledJob | null {
    try {
      // Generate job name
      const className = instance.constructor.name;
      const jobName = metadata.options?.name || `${className}.${methodName}`;

      // Check if disabled
      if (metadata.options?.disabled) {
        // Skipping disabled job
        return null;
      }

      // Register the job
      const job = this.registry.registerJob(
        jobName,
        metadata.type,
        metadata.pattern!,
        instance,
        methodName,
        metadata.options
      );

      return job;
    } catch (error) {
      // Failed to register job
      return null;
    }
  }

  /**
   * Discover jobs in a module
   */
  async discoverModule(module: any): Promise<ScheduledJob[]> {
    const jobs: ScheduledJob[] = [];

    // Get module metadata
    const moduleMetadata = Reflect.getMetadata('nexus:module', module) || {};
    const providers = moduleMetadata.providers || [];

    for (const provider of providers) {
      let instance: any;

      // Resolve provider instance
      if (typeof provider === 'function') {
        try {
          instance = this.container.resolve(provider);
        } catch (error) {
          // Failed to resolve provider
          continue;
        }
      } else if (provider.useClass) {
        try {
          instance = this.container.resolve(provider.useClass);
        } catch (error) {
          // Failed to resolve provider
          continue;
        }
      }

      if (instance) {
        const providerJobs = await this.discoverProviderJobs(instance);
        jobs.push(...providerJobs);
      }
    }

    return jobs;
  }

  /**
   * Get all providers from container
   */
  private getAllProviders(): any[] {
    const providers: any[] = [];

    // This is a simplified version - in a real implementation,
    // we would need to traverse the container's registry
    // For now, return empty array
    return providers;
  }

  /**
   * Rediscover jobs (useful for dynamic modules)
   */
  async rediscover(): Promise<ScheduledJob[]> {
    // Clear discovered providers
    this.discoveredProviders.clear();

    // Discover again
    return this.discover();
  }

  /**
   * Check if a class has scheduled jobs
   */
  hasScheduledJobs(target: any): boolean {
    const jobs = getScheduledJobs(target);
    return jobs.length > 0;
  }

  /**
   * Get job metadata for a method
   */
  getJobMetadata(target: any, propertyKey: string | symbol): JobMetadata | null {
    const cronMetadata = Reflect.getMetadata(SCHEDULER_METADATA.CRON_JOB, target, propertyKey);
    if (cronMetadata) return cronMetadata;

    const intervalMetadata = Reflect.getMetadata(SCHEDULER_METADATA.INTERVAL, target, propertyKey);
    if (intervalMetadata) return intervalMetadata;

    const timeoutMetadata = Reflect.getMetadata(SCHEDULER_METADATA.TIMEOUT, target, propertyKey);
    if (timeoutMetadata) return timeoutMetadata;

    return null;
  }
}