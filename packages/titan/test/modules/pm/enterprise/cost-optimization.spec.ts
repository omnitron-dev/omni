/**
 * Comprehensive Tests for Cost Optimization
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  CostOptimizer,
  type CostConfig,
  type ResourceUsage,
  type BudgetAction,
} from '../../../../src/modules/pm/enterprise/cost-optimization.js';

describe('CostOptimizer', () => {
  let optimizer: CostOptimizer;

  beforeEach(() => {
    jest.clearAllMocks();
    
    const config: CostConfig = {
      budget: {
        monthly: 1000,
        alert: 0.8,
        actions: [
          { threshold: 0.9, action: 'alert' as const },
          { threshold: 0.95, action: 'throttle' as const },
        ],
      },
      optimization: {
        spotInstances: true,
        autoScaleDown: 'balanced' as const,
        idleShutdown: '5m',
        resourcePacking: true,
        predictiveScaling: true,
      },
      monitoring: {
        enabled: true,
        interval: '1h',
      },
    };

    optimizer = new CostOptimizer(config);
  });

  afterEach(() => {
    optimizer.removeAllListeners();
  });

  describe('Resource Tracking', () => {
    it('should track resource usage', () => {
      const usage: ResourceUsage = {
        cpu: 50,
        memory: 2048,
        network: 1000,
        storage: 100,
        requests: 100,
      };

      optimizer.trackUsage('resource-1', usage);
      
      // Verify internal state
      expect((optimizer as any).resourceUsage.has('resource-1')).toBe(true);
    });

    it('should calculate compute costs', () => {
      const usage: ResourceUsage = {
        cpu: 100,
        memory: 4096,
        network: 0,
        storage: 0,
      };

      const cost = (optimizer as any).calculateComputeCost(usage);
      expect(cost).toBeGreaterThan(0);
      expect(typeof cost).toBe('number');
    });

    it('should calculate storage costs', () => {
      const usage: ResourceUsage = {
        cpu: 0,
        memory: 0,
        network: 0,
        storage: 1000, // 1000 GB
      };

      const cost = (optimizer as any).calculateStorageCost(usage);
      expect(cost).toBeGreaterThan(0);
    });

    it('should calculate network costs', () => {
      const usage: ResourceUsage = {
        cpu: 0,
        memory: 0,
        network: 10240, // 10GB
        storage: 0,
      };

      const cost = (optimizer as any).calculateNetworkCost(usage);
      expect(cost).toBeGreaterThan(0);
    });
  });

  describe('Budget Management', () => {
    it('should emit budget alerts', (done) => {
      optimizer.on('budget:alert', (data) => {
        expect(data.projected).toBeGreaterThan(data.budget * 0.8);
        done();
      });

      // Simulate high cost
      for (let i = 0; i < 10; i++) {
        optimizer.trackUsage(`resource-${i}`, {
          cpu: 100,
          memory: 8192,
          network: 1000,
          storage: 100,
        });
      }

      (optimizer as any).collectMetrics();
    });

    it.skip('should execute budget actions at thresholds', (done) => {
      optimizer.on('budget:action', (action: BudgetAction) => {
        expect(action.action).toBeDefined();
        expect(action.threshold).toBeDefined();
        done();
      });

      // Set very high costs
      (optimizer as any).projectedCost = 950; // 95% of budget

      (optimizer as any).collectMetrics();
    });

    it('should throttle resources on budget exceeded', (done) => {
      optimizer.on('resources:throttled', () => {
        done();
      });

      (optimizer as any).throttleResources('all');
    });

    it('should stop resources on critical budget exceeded', (done) => {
      optimizer.on('resources:stopped', () => {
        done();
      });

      (optimizer as any).stopResources('non-critical');
    });
  });

  describe('Cost Analysis', () => {
    beforeEach(() => {
      // Add some resource usage
      optimizer.trackUsage('res-1', {
        cpu: 80,
        memory: 4096,
        network: 500,
        storage: 50,
        requests: 1000,
      });
    });

    it('should detect idle resources', () => {
      optimizer.trackUsage('idle-resource', {
        cpu: 5,
        memory: 1024,
        network: 0,
        storage: 10,
        requests: 0,
      });

      let recommendations: any[] = [];
      optimizer.on('recommendations', (recs) => {
        recommendations = recs;
      });

      (optimizer as any).analyzeUsage();

      const idleRec = recommendations.find(r => r.type === 'idle-resource');
      expect(idleRec).toBeDefined();
    });

    it.skip('should detect over-provisioned resources', () => {
      optimizer.trackUsage('over-provisioned', {
        cpu: 20,
        memory: 1024,
        network: 100,
        storage: 10,
      });

      let recommendations: any[] = [];
      optimizer.on('recommendations', (recs) => {
        recommendations = recs;
      });

      (optimizer as any).analyzeUsage();

      const overRec = recommendations.find(r => r.type === 'over-provisioned');
      expect(overRec).toBeDefined();
    });

    it('should identify spot instance opportunities', () => {
      optimizer.trackUsage('spot-candidate', {
        cpu: 50,
        memory: 2048,
        network: 200,
        storage: 20,
      });

      let recommendations: any[] = [];
      optimizer.on('recommendations', (recs) => {
        recommendations = recs;
      });

      (optimizer as any).analyzeUsage();

      const spotRec = recommendations.find(r => r.type === 'spot-opportunity');
      expect(spotRec).toBeDefined();
    });
  });

  describe('Instance Selection', () => {
    it('should select optimal on-demand instance', () => {
      const instance = optimizer.selectOptimalInstance({
        cpu: 2,
        memory: 4096,
      });

      expect(instance).toBeDefined();
      expect(instance?.cpu).toBeGreaterThanOrEqual(2);
      expect(instance?.memory).toBeGreaterThanOrEqual(4096);
    });

    it('should select optimal spot instance', () => {
      const instance = optimizer.selectOptimalInstance({
        cpu: 2,
        memory: 2048,
        spot: true,
      });

      expect(instance).toBeDefined();
      expect(instance?.type).toBe('spot');
    });

    it('should return null if no instance meets requirements', () => {
      const instance = optimizer.selectOptimalInstance({
        cpu: 1000,
        memory: 1000000,
      });

      expect(instance).toBeNull();
    });

    it.skip('should select cheapest instance that meets requirements', () => {
      const instance = optimizer.selectOptimalInstance({
        cpu: 2,
        memory: 1024,
      });

      expect(instance).toBeDefined();
      expect(instance?.id).toBe('t3.micro');
    });
  });

  describe('Resource Optimization', () => {
    it('should pack resources for better utilization', () => {
      // Add multiple small resources
      for (let i = 0; i < 5; i++) {
        optimizer.trackUsage(`small-${i}`, {
          cpu: 20,
          memory: 1024,
          network: 100,
          storage: 10,
        });
      }

      let optimized = false;
      optimizer.on('packing:optimized', (data) => {
        expect(data.after).toBeLessThan(data.before);
        optimized = true;
      });

      (optimizer as any).packResources();
    });

    it('should perform predictive scaling during business hours', () => {
      let scalingEvent: any = null;
      optimizer.on('scaling:predictive', (event) => {
        scalingEvent = event;
      });

      // Mock business hours
      const originalHours = Date.prototype.getHours;
      Date.prototype.getHours = jest.fn().mockReturnValue(13); // 1 PM
      Date.prototype.getDay = jest.fn().mockReturnValue(3); // Wednesday

      (optimizer as any).predictiveScale();

      expect(scalingEvent).toBeDefined();
      expect(scalingEvent?.reason).toBe('peak-hour');

      // Restore
      Date.prototype.getHours = originalHours;
    });

    it('should optimize serverless functions', () => {
      (optimizer as any).config.optimization.serverless = {
        enabled: true,
        memory: 'auto',
      };

      optimizer.trackUsage('lambda-1', {
        cpu: 10,
        memory: 512,
        network: 50,
        storage: 5,
      });

      let optimizationEvent: any = null;
      optimizer.on('serverless:optimize', (event) => {
        optimizationEvent = event;
      });

      (optimizer as any).optimizeServerless();

      expect(optimizationEvent).toBeDefined();
      expect(optimizationEvent?.memory).toBeGreaterThanOrEqual(128);
    });
  });

  describe('Batch Optimization', () => {
    it('should use spot instances for large batches', () => {
      const jobs = Array.from({ length: 1500 }, (_, i) => ({
        id: `job-${i}`,
        work: 1,
      }));

      const optimization = optimizer.optimizeBatch(jobs);

      expect(optimization.strategy).toBe('spot');
      expect(optimization.estimatedCost).toBeLessThan(jobs.length * 0.01);
    });

    it('should use on-demand for urgent jobs', () => {
      const jobs = Array.from({ length: 100 }, (_, i) => ({
        id: `job-${i}`,
        work: 1,
        urgent: true,
      }));

      const optimization = optimizer.optimizeBatch(jobs);

      expect(optimization.strategy).toBe('on-demand');
    });

    it('should calculate instance requirements', () => {
      const jobs = Array.from({ length: 500 }, () => ({ work: 1 }));

      const optimization = optimizer.optimizeBatch(jobs);

      expect(optimization.instances).toBeGreaterThan(0);
      expect(optimization.estimatedTime).toBeGreaterThan(0);
    });
  });

  describe('Cost Reporting', () => {
    beforeEach(() => {
      optimizer.trackUsage('res-report', {
        cpu: 50,
        memory: 2048,
        network: 500,
        storage: 50,
      });
    });

    it('should generate cost report', () => {
      const report = optimizer.getCostReport();

      expect(report.current).toBeDefined();
      expect(report.current.hourly).toBeDefined();
      expect(report.current.daily).toBeDefined();
      expect(report.current.monthly).toBeDefined();
    });

    it('should include cost breakdown', () => {
      const report = optimizer.getCostReport();

      expect(report.breakdown).toBeDefined();
      expect(report.breakdown.compute).toBeDefined();
      expect(report.breakdown.storage).toBeDefined();
      expect(report.breakdown.network).toBeDefined();
    });

    it('should calculate savings', () => {
      const report = optimizer.getCostReport();

      expect(report.savings).toBeDefined();
      expect(report.savings.realized).toBeDefined();
      expect(report.savings.potential).toBeDefined();
    });

    it('should provide recommendations', () => {
      const report = optimizer.getCostReport();

      expect(report.recommendations).toBeDefined();
      expect(Array.isArray(report.recommendations)).toBe(true);
    });
  });

  describe('Idle Shutdown', () => {
    it('should schedule shutdown for idle resources', (done) => {
      jest.useFakeTimers();

      optimizer.on('resource:shutdown', ({ resourceId }) => {
        expect(resourceId).toBe('idle-1');
        done();
      });

      optimizer.trackUsage('idle-1', {
        cpu: 0,
        memory: 1024,
        network: 0,
        storage: 10,
        requests: 0,
      });

      jest.advanceTimersByTime(5 * 60 * 1000 + 100); // 5 minutes + buffer

      jest.useRealTimers();
    });

    it('should not shutdown active resources', (done) => {
      jest.useFakeTimers();

      let shutdownCalled = false;
      optimizer.on('resource:shutdown', () => {
        shutdownCalled = true;
      });

      optimizer.trackUsage('active-1', {
        cpu: 50,
        memory: 2048,
        network: 1000,
        storage: 50,
        requests: 100,
      });

      jest.advanceTimersByTime(5 * 60 * 1000);

      setTimeout(() => {
        expect(shutdownCalled).toBe(false);
        done();
      }, 100);

      jest.runAllTimers();
      jest.useRealTimers();
    });
  });

  describe('Resource Management', () => {
    it('should downsize over-provisioned resources', (done) => {
      optimizer.on('resource:downsized', ({ resourceId }) => {
        expect(resourceId).toBe('oversized-1');
        done();
      });

      optimizer.trackUsage('oversized-1', {
        cpu: 100,
        memory: 4096,
        network: 0,
        storage: 0,
      });

      (optimizer as any).downsizeResource('oversized-1');
    });

    it('should convert to spot instances', (done) => {
      optimizer.on('resource:converted-to-spot', ({ resourceId }) => {
        expect(resourceId).toBe('convert-1');
        done();
      });

      (optimizer as any).convertToSpot('convert-1');
    });
  });
});
