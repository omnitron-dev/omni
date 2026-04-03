/**
 * Scheduler Discovery Service
 *
 * Discovers and registers scheduled jobs from decorated classes
 */

import { Container } from '@omnitron-dev/titan/nexus';
import { Inject, Optional, Injectable } from '@omnitron-dev/titan/decorators';

import { getScheduledJobs } from './scheduler.decorators.js';
import { SCHEDULER_METADATA, SCHEDULER_CONFIG_TOKEN, SCHEDULER_REGISTRY_TOKEN } from './scheduler.constants.js';

import type { SchedulerRegistry } from './scheduler.registry.js';
import type { IJobMetadata, IScheduledJob, ISchedulerConfig } from './scheduler.interfaces.js';

/**
 * Discovers scheduled jobs in the application
 */
@Injectable()
export class SchedulerDiscovery {
  private discoveredProviders = new Set<any>();

  constructor(
    @Inject(Container) private readonly container: Container,
    @Inject(SCHEDULER_REGISTRY_TOKEN) private readonly registry: SchedulerRegistry,
    @Optional() @Inject(SCHEDULER_CONFIG_TOKEN) private readonly config?: ISchedulerConfig
  ) {}

  /**
   * Discover and register all scheduled jobs.
   * Scans container registrations for providers with @Cron/@Interval/@Timeout decorators,
   * resolves them (triggering @PostConstruct), and registers their scheduled methods.
   */
  async discover(): Promise<IScheduledJob[]> {
    const jobs: IScheduledJob[] = [];

    // Resolve all providers with scheduled job metadata (async to support async deps)
    const providers = await this.resolveSchedulableProviders();

    for (const provider of providers) {
      const providerJobs = await this.discoverProviderJobs(provider);
      jobs.push(...providerJobs);
    }

    return jobs;
  }

  /**
   * Discover jobs in a specific provider
   */
  async discoverProviderJobs(provider: any): Promise<IScheduledJob[]> {
    if (!provider || typeof provider !== 'object') {
      return [];
    }

    // Check if already discovered
    if (this.discoveredProviders.has(provider)) {
      return [];
    }
    this.discoveredProviders.add(provider);

    const jobs: IScheduledJob[] = [];
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
  private registerJob(instance: any, methodName: string, metadata: IJobMetadata): IScheduledJob | null {
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
    } catch {
      // Failed to register job
      return null;
    }
  }

  /**
   * Discover jobs in a module
   */
  async discoverModule(module: any): Promise<IScheduledJob[]> {
    const jobs: IScheduledJob[] = [];

    // Get module metadata
    const moduleMetadata = Reflect.getMetadata('nexus:module', module) || {};
    const providers = moduleMetadata.providers || [];

    for (const provider of providers) {
      let instance: any;

      // Resolve provider instance
      if (typeof provider === 'function') {
        try {
          instance = this.container.resolve(provider);
        } catch {
          // Failed to resolve provider
          continue;
        }
      } else if (provider.useClass) {
        try {
          instance = this.container.resolve(provider.useClass);
        } catch {
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
   * Get all providers from container that have scheduled job metadata.
   * Scans container registrations for classes with @Cron/@Interval/@Timeout decorators
   * and resolves them eagerly so their scheduled methods can be discovered.
   */
  private getAllProviders(): any[] {
    const providers: any[] = [];

    // Access container's internal registrations map
    type ProviderRegistration = { provider?: unknown };
    type ContainerWithRegistrations = {
      registrations?: Map<unknown, ProviderRegistration | ProviderRegistration[]>;
      resolveAsync?: (token: unknown) => Promise<unknown>;
      resolve?: (token: unknown) => unknown;
      has?: (token: unknown) => boolean;
    };

    const containerInternal = this.container as unknown as ContainerWithRegistrations;
    const registrations = containerInternal.registrations;

    if (!registrations || !(registrations instanceof Map)) {
      return providers;
    }

    // Collect classes that have scheduled jobs — we'll resolve them async in discover()
    for (const [token, registration] of registrations.entries()) {
      try {
        const regs = Array.isArray(registration) ? registration : [registration];

        for (const reg of regs) {
          const provider = reg.provider;
          if (!provider) continue;

          let targetClass: any = null;

          if (typeof provider === 'function') {
            targetClass = provider;
          } else if (typeof provider === 'object' && 'useClass' in provider) {
            targetClass = (provider as { useClass?: any }).useClass;
          }

          if (!targetClass) continue;

          // Check if this class has any scheduled job decorators
          const scheduledJobs = getScheduledJobs(targetClass);
          if (scheduledJobs.length === 0) continue;

          // Resolve the instance from the container
          try {
            if (containerInternal.has?.(token)) {
              const instance = containerInternal.resolve?.(token);
              if (instance) {
                providers.push(instance);
              }
            }
          } catch {
            // Failed to resolve — may have async dependencies, handled in discoverAsync
          }
        }
      } catch {
        // Skip invalid registrations
      }
    }

    return providers;
  }

  /**
   * Resolve all providers with @Cron/@Interval/@Timeout decorators from the container.
   * Uses async resolution to support providers with async dependencies (DB, Redis, etc.).
   */
  private async resolveSchedulableProviders(): Promise<any[]> {
    const providers: any[] = [];

    // Access container internals to scan registrations
    // This mirrors the pattern used by Application.exposeServicesToNetron()
    type ProviderRegistration = { provider?: unknown };
    type ContainerWithRegistrations = {
      registrations?: Map<unknown, ProviderRegistration | ProviderRegistration[]>;
      resolveAsync?: (token: unknown) => Promise<unknown>;
      has?: (token: unknown) => boolean;
    };

    const containerInternal = this.container as unknown as ContainerWithRegistrations;
    const registrations = containerInternal.registrations;

    if (!registrations || !(registrations instanceof Map)) {
      return providers;
    }

    // First pass: collect tokens with scheduled job metadata
    const schedulableTokens: Array<{ token: unknown; className: string; jobCount: number }> = [];

    for (const [token, registration] of registrations.entries()) {
      try {
        const regs = Array.isArray(registration) ? registration : [registration];

        for (const reg of regs) {
          const provider = reg.provider;
          if (!provider) continue;

          let targetClass: any = null;

          if (typeof provider === 'function') {
            targetClass = provider;
          } else if (typeof provider === 'object' && 'useClass' in provider) {
            targetClass = (provider as { useClass?: any }).useClass;
          }

          if (!targetClass) continue;

          const scheduledJobs = getScheduledJobs(targetClass);
          if (scheduledJobs.length > 0) {
            schedulableTokens.push({
              token,
              className: targetClass.name || 'Unknown',
              jobCount: scheduledJobs.length,
            });
          }
        }
      } catch {
        // Skip invalid registrations
      }
    }

    // Second pass: resolve each schedulable provider
    for (const { token } of schedulableTokens) {
      try {
        const hasToken = containerInternal.has?.(token);
        if (!hasToken) continue;

        if (containerInternal.resolveAsync) {
          const instance = await containerInternal.resolveAsync(token);
          if (instance) {
            providers.push(instance);
          }
        }
      } catch {
        // Skip providers that fail to resolve (missing dependencies, etc.)
      }
    }

    return providers;
  }

  /**
   * Rediscover jobs (useful for dynamic modules)
   */
  async rediscover(): Promise<IScheduledJob[]> {
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
  getJobMetadata(target: any, propertyKey: string | symbol): IJobMetadata | null {
    const cronMetadata = Reflect.getMetadata(SCHEDULER_METADATA.CRON_JOB, target, propertyKey);
    if (cronMetadata) return cronMetadata;

    const intervalMetadata = Reflect.getMetadata(SCHEDULER_METADATA.INTERVAL, target, propertyKey);
    if (intervalMetadata) return intervalMetadata;

    const timeoutMetadata = Reflect.getMetadata(SCHEDULER_METADATA.TIMEOUT, target, propertyKey);
    if (timeoutMetadata) return timeoutMetadata;

    return null;
  }
}
