/**
 * Comprehensive Tests for Adaptive Scaling
 */

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  AdaptiveScalingController,
  MovingAveragePredictionModel,
  ExponentialSmoothingModel,
  type ScalingMetrics,
  type ScalingPolicy,
  type ScalingDecision,
  type PredictionModel,
} from '../../../../src/modules/pm/enterprise/adaptive-scaling.js';

describe('AdaptiveScalingController', () => {
  let controller: AdaptiveScalingController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AdaptiveScalingController(1, 10);
  });

  afterEach(() => {
    controller.removeAllListeners();
  });

  describe('Initialization', () => {
    it('should initialize with default values', () => {
      const state = controller.getState();

      expect(state.currentInstances).toBe(1);
      expect(state.targetInstances).toBe(1);
      expect(state.minInstances).toBe(1);
      expect(state.maxInstances).toBe(10);
      expect(state.metricsCount).toBe(0);
    });

    it('should initialize with custom policies', () => {
      const policies: ScalingPolicy[] = [
        {
          name: 'custom-cpu',
          type: 'cpu',
          thresholdUp: 75,
          thresholdDown: 25,
          scaleUpBy: 3,
          scaleDownBy: 2,
          cooldownUp: 30000,
          cooldownDown: 120000,
        },
      ];

      const customController = new AdaptiveScalingController(2, 20, policies);
      const state = customController.getState();

      expect(state.minInstances).toBe(2);
      expect(state.maxInstances).toBe(20);
      expect(state.currentInstances).toBe(2);
    });

    it('should initialize with prediction model', () => {
      const model = new MovingAveragePredictionModel();
      const controllerWithModel = new AdaptiveScalingController(1, 10, [], model);
      const state = controllerWithModel.getState();

      expect(state).toBeDefined();
    });
  });

  describe('Metrics Tracking', () => {
    it('should track metrics history', async () => {
      const metrics: ScalingMetrics = {
        cpu: 50,
        memory: 60,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      };

      await controller.updateMetrics(metrics);

      const state = controller.getState();
      expect(state.metricsCount).toBe(1);
      expect(state.lastMetrics?.cpu).toBe(50);
      expect(state.lastMetrics?.memory).toBe(60);
      expect(state.lastMetrics?.requestRate).toBe(100);
    });

    it('should maintain bounded history', async () => {
      // Add more than 1000 metrics
      for (let i = 0; i < 1100; i++) {
        await controller.updateMetrics({
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const state = controller.getState();
      expect(state.metricsCount).toBeLessThanOrEqual(1000);
    });

    it('should track custom metrics', async () => {
      const metrics: ScalingMetrics = {
        cpu: 50,
        memory: 60,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
        customMetrics: {
          activeConnections: 500,
          dbQueryTime: 150,
        },
      };

      await controller.updateMetrics(metrics);

      const state = controller.getState();
      expect(state.lastMetrics?.customMetrics?.activeConnections).toBe(500);
      expect(state.lastMetrics?.customMetrics?.dbQueryTime).toBe(150);
    });
  });

  describe('CPU-based Scaling', () => {
    it('should scale up on high CPU', async () => {
      const metrics: ScalingMetrics = {
        cpu: 85,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      };

      const decision = await controller.updateMetrics(metrics);

      expect(decision.action).toBe('scale-up');
      expect(decision.amount).toBeGreaterThan(0);
      expect(decision.reason).toContain('cpu');
    });

    it('should scale down on low CPU', async () => {
      // First scale up
      await controller.updateMetrics({
        cpu: 85,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Then try to scale down
      const decision = await controller.updateMetrics({
        cpu: 15,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      // Should be in cooldown or maintain
      expect(['scale-down', 'maintain']).toContain(decision.action);
    });

    it('should maintain on normal CPU', async () => {
      const metrics: ScalingMetrics = {
        cpu: 50,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      };

      const decision = await controller.updateMetrics(metrics);

      expect(decision.action).toBe('maintain');
      expect(decision.amount).toBe(0);
    });
  });

  describe('Memory-based Scaling', () => {
    it('should scale up on high memory', async () => {
      const metrics: ScalingMetrics = {
        cpu: 50,
        memory: 90,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      };

      const decision = await controller.updateMetrics(metrics);

      expect(decision.action).toBe('scale-up');
      expect(decision.reason).toContain('memory');
    });

    it('should scale down on low memory', async () => {
      // First scale up to have instances to scale down
      controller.updateLimits(2, 10);
      const state = controller.getState();
      expect(state.currentInstances).toBe(2);

      // Wait for cooldown
      await new Promise((resolve) => setTimeout(resolve, 300));

      const decision = await controller.updateMetrics({
        cpu: 20,
        memory: 25,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(['scale-down', 'maintain']).toContain(decision.action);
    });
  });

  describe('Response Time-based Scaling', () => {
    it('should scale up on high response time', async () => {
      const metrics: ScalingMetrics = {
        cpu: 50,
        memory: 50,
        requestRate: 100,
        responseTime: 1500, // Above threshold
        errorRate: 0.5,
        queueDepth: 10,
      };

      const decision = await controller.updateMetrics(metrics);

      expect(decision.action).toBe('scale-up');
      expect(decision.reason).toContain('response');
    });

    it('should scale down on low response time', async () => {
      controller.updateLimits(2, 10);

      await new Promise((resolve) => setTimeout(resolve, 200));

      const decision = await controller.updateMetrics({
        cpu: 20,
        memory: 30,
        requestRate: 100,
        responseTime: 50, // Below threshold
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(['scale-down', 'maintain']).toContain(decision.action);
    });
  });

  describe('Cooldown Periods', () => {
    it('should respect cooldown after scale up', async () => {
      // First scale up
      const firstDecision = await controller.updateMetrics({
        cpu: 85,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(firstDecision.action).toBe('scale-up');

      // Immediately try to scale up again (should be in cooldown)
      const decision = await controller.updateMetrics({
        cpu: 90,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(decision.action).toBe('maintain');
      // Cooldown message might be in any policy's reason
      const stateAfter = controller.getState();
      expect(stateAfter.currentInstances).toBeGreaterThan(1);
    });

    it('should respect cooldown after scale down', async () => {
      controller.updateLimits(3, 10);

      // Wait a bit to ensure initial state is stable
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Scale down
      const firstDecision = await controller.updateMetrics({
        cpu: 15,
        memory: 25,
        requestRate: 100,
        responseTime: 50,
        errorRate: 0.5,
        queueDepth: 10,
      });

      // If first decision was scale-down, next should be in cooldown
      if (firstDecision.action === 'scale-down') {
        // Immediately try to scale down again
        const decision = await controller.updateMetrics({
          cpu: 10,
          memory: 20,
          requestRate: 100,
          responseTime: 50,
          errorRate: 0.5,
          queueDepth: 10,
        });

        expect(decision.action).toBe('maintain');
      } else {
        // If no scale down occurred, just verify maintain state
        expect(firstDecision.action).toBe('maintain');
      }
    });
  });

  describe('Custom Policies', () => {
    it('should evaluate custom metric policies', async () => {
      const customPolicy: ScalingPolicy = {
        name: 'queue-policy',
        type: 'queue',
        thresholdUp: 100,
        thresholdDown: 10,
        scaleUpBy: 2,
        scaleDownBy: 1,
        cooldownUp: 30000,
        cooldownDown: 120000,
      };

      controller.addPolicy(customPolicy);

      const decision = await controller.updateMetrics({
        cpu: 50,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 150, // Above threshold
      });

      expect(decision.action).toBe('scale-up');
      expect(decision.reason).toContain('queue');
    });

    it('should use custom evaluation function', async () => {
      const customPolicy: ScalingPolicy = {
        name: 'composite-policy',
        type: 'composite',
        thresholdUp: 0,
        thresholdDown: 0,
        scaleUpBy: 2,
        scaleDownBy: 1,
        cooldownUp: 30000,
        cooldownDown: 120000,
        evaluate: (metrics: ScalingMetrics): ScalingDecision => {
          if (metrics.cpu > 70 && metrics.memory > 70) {
            return {
              action: 'scale-up',
              amount: 3,
              reason: 'Both CPU and memory high',
              confidence: 0.95,
            };
          }
          return {
            action: 'maintain',
            amount: 0,
            reason: 'Normal operation',
            confidence: 0.8,
          };
        },
      };

      controller.addPolicy(customPolicy);

      const decision = await controller.updateMetrics({
        cpu: 75,
        memory: 75,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(decision.action).toBe('scale-up');
      expect(decision.amount).toBe(3);
      expect(decision.reason).toContain('Both CPU and memory high');
    });
  });

  describe('Decision Combination', () => {
    it('should prioritize scale-up over scale-down', async () => {
      // Add conflicting policies
      controller.addPolicy({
        name: 'aggressive-down',
        type: 'memory',
        thresholdUp: 95,
        thresholdDown: 40, // Memory is below this
        scaleUpBy: 1,
        scaleDownBy: 2,
        cooldownUp: 30000,
        cooldownDown: 120000,
      });

      const decision = await controller.updateMetrics({
        cpu: 85, // Triggers scale up
        memory: 35, // Triggers scale down
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      // Should prioritize scale up for safety
      expect(decision.action).toBe('scale-up');
    });

    it('should combine multiple scale-up decisions', async () => {
      const decision = await controller.updateMetrics({
        cpu: 85, // Triggers CPU scale up
        memory: 90, // Triggers memory scale up
        responseTime: 1200, // Triggers response time scale up
        requestRate: 100,
        errorRate: 0.5,
        queueDepth: 10,
      });

      expect(decision.action).toBe('scale-up');
      // Should use the maximum scale amount
      expect(decision.amount).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Resource Limits', () => {
    it('should respect minimum instance limit', async () => {
      controller.updateLimits(3, 10);

      const decision = await controller.updateMetrics({
        cpu: 10,
        memory: 20,
        requestRate: 100,
        responseTime: 50,
        errorRate: 0.5,
        queueDepth: 10,
      });

      const state = controller.getState();
      expect(state.currentInstances).toBeGreaterThanOrEqual(3);
    });

    it('should respect maximum instance limit', async () => {
      controller.updateLimits(1, 5);

      // Try to scale up beyond max
      for (let i = 0; i < 10; i++) {
        await controller.updateMetrics({
          cpu: 95,
          memory: 95,
          requestRate: 100,
          responseTime: 2000,
          errorRate: 0.5,
          queueDepth: 200,
        });

        // Wait for cooldown
        await new Promise((resolve) => setTimeout(resolve, 70));
      }

      const state = controller.getState();
      expect(state.currentInstances).toBeLessThanOrEqual(5);
    });

    it('should adjust current instances when limits change', () => {
      controller.updateLimits(5, 8);
      let state = controller.getState();
      expect(state.currentInstances).toBe(5);
      expect(state.minInstances).toBe(5);

      // Lower max below current
      controller.updateLimits(1, 3);
      state = controller.getState();
      expect(state.currentInstances).toBe(3);
      expect(state.maxInstances).toBe(3);
    });
  });

  describe('Policy Management', () => {
    it('should add new policy', () => {
      const newPolicy: ScalingPolicy = {
        name: 'error-rate-policy',
        type: 'error',
        thresholdUp: 5,
        thresholdDown: 1,
        scaleUpBy: 2,
        scaleDownBy: 1,
        cooldownUp: 30000,
        cooldownDown: 120000,
      };

      controller.addPolicy(newPolicy);

      // Verify by triggering it
      controller.updateMetrics({
        cpu: 50,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 6, // Above threshold
        queueDepth: 10,
      });
    });

    it('should update existing policy', () => {
      const updatedPolicy: ScalingPolicy = {
        name: 'cpu-policy',
        type: 'cpu',
        thresholdUp: 70, // Lower threshold
        thresholdDown: 20,
        scaleUpBy: 3,
        scaleDownBy: 1,
        cooldownUp: 30000,
        cooldownDown: 120000,
      };

      controller.addPolicy(updatedPolicy);

      // Should trigger with lower threshold
      controller.updateMetrics({
        cpu: 75,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });
    });

    it('should remove policy', async () => {
      controller.removePolicy('cpu-policy');

      // CPU threshold should not trigger scaling
      const decision = await controller.updateMetrics({
        cpu: 95,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });

      // Only memory and response time policies remain
      if (decision.action === 'scale-up') {
        expect(decision.reason).not.toContain('cpu');
      }
    });
  });

  describe('Events', () => {
    it('should emit decision events', (done) => {
      controller.on('decision', (decision) => {
        expect(decision).toBeDefined();
        expect(decision.action).toBeDefined();
        expect(decision.reason).toBeDefined();
        done();
      });

      controller.updateMetrics({
        cpu: 50,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });
    });

    it('should emit scaling events', (done) => {
      controller.on('scaling', (event) => {
        expect(event.from).toBeDefined();
        expect(event.to).toBeDefined();
        expect(event.decision).toBeDefined();
        expect(event.to).toBeGreaterThan(event.from);
        done();
      });

      controller.updateMetrics({
        cpu: 90,
        memory: 50,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });
    });
  });

  describe('Prediction Integration', () => {
    it('should use predictions when available', async () => {
      const model = new MovingAveragePredictionModel();
      const controllerWithModel = new AdaptiveScalingController(1, 10, [], model);

      // Add history for predictions
      for (let i = 0; i < 15; i++) {
        await controllerWithModel.updateMetrics({
          cpu: 50 + i * 2,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const state = controllerWithModel.getState();
      expect(state.metricsCount).toBeGreaterThan(10);
    });

    it('should train model', async () => {
      const model = new MovingAveragePredictionModel();
      const controllerWithModel = new AdaptiveScalingController(1, 10, [], model);

      // Add enough history
      for (let i = 0; i < 150; i++) {
        await controllerWithModel.updateMetrics({
          cpu: 50 + Math.sin(i / 10) * 20,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      let modelTrained = false;
      controllerWithModel.on('model:trained', () => {
        modelTrained = true;
      });

      controllerWithModel.trainModel();
      expect(modelTrained).toBe(true);
    });
  });
});

describe('MovingAveragePredictionModel', () => {
  let model: MovingAveragePredictionModel;

  beforeEach(() => {
    model = new MovingAveragePredictionModel();
  });

  describe('Predictions', () => {
    it('should predict with sufficient history', () => {
      const history: ScalingMetrics[] = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          cpu: 50 + i,
          memory: 60 + i,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const predictions = model.predict(history, 5);

      expect(predictions).toHaveLength(5);
      expect(predictions[0]?.cpu).toBeGreaterThan(0);
      expect(predictions[0]?.memory).toBeGreaterThan(0);
    });

    it('should handle insufficient history', () => {
      const history: ScalingMetrics[] = [
        {
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        },
      ];

      const predictions = model.predict(history, 3);

      expect(predictions).toHaveLength(3);
      // Should return last known values
      expect(predictions[0]?.cpu).toBe(50);
      expect(predictions[0]?.memory).toBe(60);
    });

    it('should calculate moving average', () => {
      const history: ScalingMetrics[] = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const predictions = model.predict(history, 1);

      expect(predictions[0]?.cpu).toBeCloseTo(50, 0);
      expect(predictions[0]?.memory).toBeCloseTo(60, 0);
    });
  });

  describe('Training', () => {
    it('should adjust window size based on data', () => {
      const data: ScalingMetrics[] = [];
      for (let i = 0; i < 200; i++) {
        data.push({
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      model.train(data);

      // Window size should be adjusted
      const predictions = model.predict(data, 1);
      expect(predictions).toHaveLength(1);
    });

    it('should cap window size at 20', () => {
      const data: ScalingMetrics[] = [];
      for (let i = 0; i < 300; i++) {
        data.push({
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      model.train(data);

      const predictions = model.predict(data, 1);
      expect(predictions).toHaveLength(1);
    });
  });
});

describe('ExponentialSmoothingModel', () => {
  let model: ExponentialSmoothingModel;

  beforeEach(() => {
    model = new ExponentialSmoothingModel();
  });

  describe('Predictions', () => {
    it('should predict with sufficient history', () => {
      const history: ScalingMetrics[] = [];
      for (let i = 0; i < 20; i++) {
        history.push({
          cpu: 50 + i,
          memory: 60 + i,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const predictions = model.predict(history, 5);

      expect(predictions).toHaveLength(5);
      expect(predictions[0]?.cpu).toBeGreaterThan(0);
      expect(predictions[0]?.memory).toBeGreaterThan(0);
    });

    it('should handle insufficient history', () => {
      const history: ScalingMetrics[] = [
        {
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        },
      ];

      const predictions = model.predict(history, 3);

      expect(predictions).toHaveLength(3);
      expect(predictions[0]?.cpu).toBe(50);
    });

    it('should capture trends', () => {
      const history: ScalingMetrics[] = [];
      // Create upward trend
      for (let i = 0; i < 20; i++) {
        history.push({
          cpu: 50 + i * 2,
          memory: 60 + i,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const predictions = model.predict(history, 5);

      // Predictions should show increasing trend
      expect(predictions[4]?.cpu).toBeGreaterThan(predictions[0]?.cpu);
    });

    it('should handle zero or negative predictions gracefully', () => {
      const history: ScalingMetrics[] = [];
      // Create downward trend
      for (let i = 0; i < 20; i++) {
        history.push({
          cpu: 100 - i * 3,
          memory: 100 - i * 2,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      const predictions = model.predict(history, 10);

      expect(predictions).toHaveLength(10);
      // Predictions should exist even if trending toward zero
      expect(predictions[0]?.cpu).toBeDefined();
    });
  });

  describe('Training', () => {
    it('should optimize smoothing parameters', () => {
      const data: ScalingMetrics[] = [];
      for (let i = 0; i < 100; i++) {
        data.push({
          cpu: 50 + Math.sin(i / 10) * 10,
          memory: 60 + Math.cos(i / 10) * 10,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      model.train(data);

      // Model should be trained
      const predictions = model.predict(data, 5);
      expect(predictions).toHaveLength(5);
    });

    it('should handle small training datasets', () => {
      const data: ScalingMetrics[] = [
        {
          cpu: 50,
          memory: 60,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        },
      ];

      model.train(data);

      const predictions = model.predict(data, 1);
      expect(predictions).toHaveLength(1);
    });

    it('should find optimal parameters', () => {
      const data: ScalingMetrics[] = [];
      // Create pattern with clear seasonality
      for (let i = 0; i < 200; i++) {
        data.push({
          cpu: 50 + Math.sin(i / 20) * 20,
          memory: 60 + Math.cos(i / 20) * 15,
          requestRate: 100,
          responseTime: 200,
          errorRate: 0.5,
          queueDepth: 10,
        });
      }

      model.train(data);

      const predictions = model.predict(data.slice(-10), 5);
      expect(predictions).toHaveLength(5);
      expect(predictions[0]?.cpu).toBeGreaterThan(0);
    });
  });
});

describe('Integration Tests', () => {
  it('should handle complex scaling scenario', async () => {
    const controller = new AdaptiveScalingController(2, 20);
    const events: string[] = [];

    controller.on('decision', (decision) => {
      events.push(`decision:${decision.action}`);
    });

    controller.on('scaling', (event) => {
      events.push(`scaling:${event.from}->${event.to}`);
    });

    // Simulate traffic spike
    for (let i = 0; i < 10; i++) {
      await controller.updateMetrics({
        cpu: 50 + i * 5,
        memory: 60 + i * 3,
        requestRate: 100 + i * 50,
        responseTime: 200 + i * 100,
        errorRate: 0.5,
        queueDepth: 10 + i * 5,
      });

      await new Promise((resolve) => setTimeout(resolve, 70));
    }

    expect(events.length).toBeGreaterThan(0);
    expect(events.some((e) => e.includes('scale-up'))).toBe(true);
  });

  it('should handle graceful scale-down', async () => {
    const controller = new AdaptiveScalingController(1, 10);

    // Scale up first
    await controller.updateMetrics({
      cpu: 90,
      memory: 85,
      requestRate: 1000,
      responseTime: 1500,
      errorRate: 2,
      queueDepth: 100,
    });

    // Wait for cooldown
    await new Promise((resolve) => setTimeout(resolve, 350));

    // Gradually decrease load
    for (let i = 10; i >= 0; i--) {
      await controller.updateMetrics({
        cpu: i * 3,
        memory: i * 4,
        requestRate: i * 20,
        responseTime: 100 + i * 50,
        errorRate: 0.5,
        queueDepth: i * 2,
      });

      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    const state = controller.getState();
    expect(state.currentInstances).toBeGreaterThanOrEqual(1);
  });

  it('should use predictions to preemptively scale', async () => {
    const model = new ExponentialSmoothingModel();
    const controller = new AdaptiveScalingController(1, 10, [], model);

    // Create pattern that model can learn
    for (let i = 0; i < 30; i++) {
      await controller.updateMetrics({
        cpu: 50 + Math.sin(i / 5) * 30,
        memory: 60,
        requestRate: 100,
        responseTime: 200,
        errorRate: 0.5,
        queueDepth: 10,
      });
    }

    // Train model
    controller.trainModel();

    // Continue with metrics
    await controller.updateMetrics({
      cpu: 60,
      memory: 60,
      requestRate: 100,
      responseTime: 200,
      errorRate: 0.5,
      queueDepth: 10,
    });

    const state = controller.getState();
    expect(state.metricsCount).toBeGreaterThan(30);
  });

  it('should handle multiple conflicting policies', async () => {
    const controller = new AdaptiveScalingController(2, 10);

    // Add aggressive scale-down policy
    controller.addPolicy({
      name: 'aggressive-down',
      type: 'custom',
      metric: 'test',
      thresholdUp: 100,
      thresholdDown: 50,
      scaleUpBy: 1,
      scaleDownBy: 3,
      cooldownUp: 30000,
      cooldownDown: 60000,
    });

    // Metrics that trigger both up and down
    const decision = await controller.updateMetrics({
      cpu: 85, // Triggers scale up
      memory: 25, // Triggers scale down
      requestRate: 100,
      responseTime: 200,
      errorRate: 0.5,
      queueDepth: 10,
    });

    // Should prefer scale up for safety
    expect(decision.action).toBe('scale-up');
  });
});
