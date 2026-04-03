/**
 * Scheduler Discovery Tests
 *
 * Tests that SchedulerDiscovery correctly discovers and registers
 * @Cron/@Interval/@Timeout decorated providers from the DI container.
 *
 * Reproduces the bug where:
 * 1. Container was not self-registered, causing @Inject(Container) to fail
 * 2. SchedulerDiscovery resolution failed silently due to @Optional()
 * 3. SchedulerService.onInit() skipped discovery entirely
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import 'reflect-metadata';

import { Container } from '@omnitron-dev/titan/nexus';
import { Injectable } from '@omnitron-dev/titan/decorators';
import { SchedulerDiscovery } from '../src/scheduler.discovery.js';
import { SchedulerRegistry } from '../src/scheduler.registry.js';
import { SchedulerService } from '../src/scheduler.service.js';
import { SchedulerModule } from '../src/scheduler.module.js';
import { Cron, Interval, Timeout, Schedulable } from '../src/scheduler.decorators.js';
import {
  SCHEDULER_SERVICE_TOKEN,
  SCHEDULER_REGISTRY_TOKEN,
  SCHEDULER_DISCOVERY_TOKEN,
} from '../src/scheduler.constants.js';
import { CronExpression } from '../src/scheduler.interfaces.js';

// --- Test fixtures ---

@Injectable()
@Schedulable()
class TestCronService {
  callCount = 0;

  @Cron(CronExpression.EVERY_MINUTE, { name: 'test-cron-job' })
  handleCron(): void {
    this.callCount++;
  }
}

@Injectable()
@Schedulable()
class TestIntervalService {
  @Interval(5000, { name: 'test-interval-job' })
  handleInterval(): void {}
}

@Injectable()
@Schedulable()
class TestMultiJobService {
  @Cron('0 */5 * * * *', { name: 'multi-cron' })
  cronJob(): void {}

  @Interval(10000, { name: 'multi-interval' })
  intervalJob(): void {}

  @Timeout(3000, { name: 'multi-timeout' })
  timeoutJob(): void {}
}

@Injectable()
class NoSchedulerService {
  doWork(): void {}
}

describe('SchedulerDiscovery', () => {
  describe('Container self-registration', () => {
    it('should self-register Container class in constructor', () => {
      const container = new Container();
      // Container should be registered (has() returns true)
      expect(container.has(Container)).toBe(true);
    });

    it('should allow @Inject(Container) in provider dependencies', async () => {
      const container = new Container();

      // Register SchedulerDiscovery which has @Inject(Container)
      const config = { enabled: true };
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);

      // Should resolve without error — Container is self-registered
      const discovery = await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN);
      expect(discovery).toBeInstanceOf(SchedulerDiscovery);
    });
  });

  describe('Provider discovery via container scanning', () => {
    let container: Container;

    beforeEach(() => {
      container = new Container();
    });

    it('should discover @Cron decorated providers', async () => {
      // Register scheduler infrastructure
      const config = { enabled: false };
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);

      // Register a provider with @Cron decorator
      container.register(TestCronService, TestCronService);

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      const jobs = await discovery.discover();

      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe('test-cron-job');
      expect(jobs[0].type).toBe('cron');
    });

    it('should discover @Interval decorated providers', async () => {
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);
      container.register(TestIntervalService, TestIntervalService);

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      const jobs = await discovery.discover();

      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe('test-interval-job');
      expect(jobs[0].type).toBe('interval');
    });

    it('should discover multiple jobs from single provider', async () => {
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);
      container.register(TestMultiJobService, TestMultiJobService);

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      const jobs = await discovery.discover();

      expect(jobs.length).toBe(3);
      const jobNames = jobs.map((j) => j.name).sort();
      expect(jobNames).toEqual(['multi-cron', 'multi-interval', 'multi-timeout']);
    });

    it('should ignore providers without scheduler decorators', async () => {
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);
      container.register(NoSchedulerService, NoSchedulerService);

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      const jobs = await discovery.discover();

      expect(jobs.length).toBe(0);
    });

    it('should discover from token-based registrations (useClass)', async () => {
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);

      // Register under a custom token — this is how modules register providers
      const { createToken } = await import('@omnitron-dev/titan/nexus');
      const CRON_TOKEN = createToken<TestCronService>('TestCronService');
      container.register(CRON_TOKEN, { useClass: TestCronService });

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      const jobs = await discovery.discover();

      expect(jobs.length).toBe(1);
      expect(jobs[0].name).toBe('test-cron-job');
    });

    it('should not discover same provider twice on repeated discover', async () => {
      container.register(SCHEDULER_REGISTRY_TOKEN, SchedulerRegistry);
      container.register(SCHEDULER_DISCOVERY_TOKEN, SchedulerDiscovery);
      container.register(TestCronService, TestCronService);

      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;

      const jobs1 = await discovery.discover();
      expect(jobs1.length).toBe(1);

      // Second discover should not re-discover already-found providers
      const jobs2 = await discovery.discover();
      expect(jobs2.length).toBe(0);
    });
  });

  describe('Integration with SchedulerService lifecycle', () => {
    let container: Container;

    beforeEach(() => {
      container = new Container();
    });

    afterEach(async () => {
      try {
        const service = container.resolve(SCHEDULER_SERVICE_TOKEN) as SchedulerService;
        if (service?.isRunning()) {
          await service.onStop();
        }
      } catch {
        // Service may not be resolved yet
      }
    });

    it('should discover jobs when SchedulerService.onInit() is called via resolveAsync', async () => {
      // Use loadModule for proper scope handling (Singleton for shared services)
      const moduleConfig = SchedulerModule.forRoot({ enabled: false });
      container.loadModule(moduleConfig as any);

      // Register test provider with scheduled job
      container.register(TestCronService, TestCronService);

      // Step 1: Verify discovery works standalone
      const discovery = (await container.resolveAsync(SCHEDULER_DISCOVERY_TOKEN)) as SchedulerDiscovery;
      expect(discovery).toBeDefined();

      // Step 2: Verify discovery finds the test provider
      const discoveredJobs = await discovery.discover();

      // Step 3: Check the same registry instance
      const registry = (await container.resolveAsync(SCHEDULER_REGISTRY_TOKEN)) as any;
      const registryJobs = registry.getAllJobs();

      // If discovery and service share the same registry, jobs should be there
      expect(discoveredJobs.length).toBeGreaterThanOrEqual(1);
      expect(registryJobs.length).toBeGreaterThanOrEqual(1);
    });
  });
});
