/**
 * Advanced Cognitive Features Tests
 * Tests for optimization, causality analysis, and enhanced explanations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Environment } from '../../../src/core/environment.js';
import { CognitiveEnvironment } from '../../../src/cognitive/cognitive-environment.js';

describe('CognitiveEnvironment - Advanced Features', () => {
  let env: Environment;
  let cognitiveEnv: CognitiveEnvironment;

  beforeEach(() => {
    env = new Environment({
      name: 'test-env',
      config: {
        performance: {
          maxConnections: 100,
          timeout: 5000,
          retryAttempts: 3,
          batchSize: 50,
        },
        resources: {
          cpuLimit: 80,
          memoryLimit: 1024,
          diskSpace: 10000,
        },
        features: {
          enableCaching: true,
          enableCompression: false,
          logLevel: 'info',
        },
      },
    });

    cognitiveEnv = new CognitiveEnvironment(env);
  });

  describe('optimize()', () => {
    it('should optimize with genetic algorithm', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'genetic',
        iterations: 50,
        populationSize: 10,
      });

      expect(result).toBeDefined();
      expect(result.algorithm).toBe('genetic');
      expect(result.iterations).toBe(50);
      expect(typeof result.score).toBe('number');
      expect(Array.isArray(result.changes)).toBe(true);
    });

    it('should optimize with gradient descent', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.timeout',
            weight: 0.5,
            target: 'minimize',
          },
        ],
        algorithm: 'gradient-descent',
        iterations: 30,
      });

      expect(result).toBeDefined();
      expect(result.algorithm).toBe('gradient-descent');
      expect(result.iterations).toBe(30);
      expect(typeof result.score).toBe('number');
    });

    it('should optimize with simulated annealing', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'resources.cpuLimit',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'simulated-annealing',
        iterations: 40,
      });

      expect(result).toBeDefined();
      expect(result.algorithm).toBe('simulated-annealing');
      expect(result.iterations).toBe(40);
    });

    it('should respect constraints during optimization', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        constraints: [
          {
            key: 'performance.maxConnections',
            type: 'max',
            value: 200,
          },
        ],
        algorithm: 'genetic',
        iterations: 20,
      });

      expect(result).toBeDefined();

      // Check that constraints are respected
      const maxConnections = env.get('performance.maxConnections');
      if (result.improved && typeof maxConnections === 'number') {
        expect(maxConnections).toBeLessThanOrEqual(200);
      }
    });

    it('should handle range constraints', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.timeout',
            weight: 1.0,
            target: 'minimize',
          },
        ],
        constraints: [
          {
            key: 'performance.timeout',
            type: 'range',
            value: [1000, 10000],
          },
        ],
        algorithm: 'genetic',
        iterations: 20,
      });

      expect(result).toBeDefined();

      // Check range constraint
      const timeout = env.get('performance.timeout');
      if (result.improved && typeof timeout === 'number') {
        expect(timeout).toBeGreaterThanOrEqual(1000);
        expect(timeout).toBeLessThanOrEqual(10000);
      }
    });

    it('should optimize multiple goals', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 0.6,
            target: 'maximize',
          },
          {
            metric: 'performance.timeout',
            weight: 0.4,
            target: 'minimize',
          },
        ],
        algorithm: 'genetic',
        iterations: 30,
      });

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
    });

    it('should use custom evaluator function', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
            evaluator: (value: number) => {
              // Custom scoring: prefer values near 150
              return 1000 - Math.abs(value - 150);
            },
          },
        ],
        algorithm: 'genetic',
        iterations: 30,
      });

      expect(result).toBeDefined();
      expect(typeof result.score).toBe('number');
    });

    it('should handle no numeric keys gracefully', async () => {
      const emptyEnv = new Environment({
        name: 'empty',
        config: {
          text: 'hello',
          flag: true,
        },
      });

      const emptyCognitive = new CognitiveEnvironment(emptyEnv);

      const result = await emptyCognitive.optimize({
        goals: [
          {
            metric: 'nonexistent',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'genetic',
        iterations: 10,
      });

      expect(result.improved).toBe(false);
      expect(result.changes).toHaveLength(0);
    });

    it('should track optimization changes', async () => {
      const result = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'genetic',
        iterations: 20,
      });

      if (result.improved) {
        expect(result.changes.length).toBeGreaterThan(0);

        for (const change of result.changes) {
          expect(change).toHaveProperty('key');
          expect(change).toHaveProperty('oldValue');
          expect(change).toHaveProperty('newValue');
          expect(change).toHaveProperty('improvement');
        }
      }
    });
  });

  describe('analyzeCausality()', () => {
    beforeEach(async () => {
      // Create some change history
      await cognitiveEnv.setConfig('performance.maxConnections', 100);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cognitiveEnv.setConfig('performance.timeout', 5000);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cognitiveEnv.setConfig('performance.maxConnections', 120);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cognitiveEnv.setConfig('performance.timeout', 6000);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cognitiveEnv.setConfig('performance.maxConnections', 140);
      await new Promise((resolve) => setTimeout(resolve, 10));

      await cognitiveEnv.setConfig('performance.timeout', 7000);
    });

    it('should analyze causal relationships', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout');

      expect(result).toBeDefined();
      expect(result.key).toBe('performance.timeout');
      expect(Array.isArray(result.causes)).toBe(true);
      expect(Array.isArray(result.effects)).toBe(true);
      expect(typeof result.timestamp).toBe('number');
    });

    it('should identify correlation strength', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout', {
        correlationThreshold: 0.3,
      });

      // Check that factors have proper strength classification
      for (const factor of [...result.causes, ...result.effects]) {
        expect(['weak', 'moderate', 'strong']).toContain(factor.strength);
        expect(typeof factor.correlation).toBe('number');
      }
    });

    it('should respect correlation threshold', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout', {
        correlationThreshold: 0.9, // Very high threshold
      });

      // With high threshold, fewer factors should be found
      expect(result.causes.length + result.effects.length).toBeLessThanOrEqual(1);
    });

    it('should support time window filtering', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout', {
        timeWindow: '100ms',
      });

      expect(result).toBeDefined();
      // Recent changes should be considered
    });

    it('should provide evidence for causal relationships', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout');

      for (const factor of [...result.causes, ...result.effects]) {
        expect(Array.isArray(factor.evidence)).toBe(true);
        expect(factor.evidence.length).toBeGreaterThan(0);
      }
    });

    it('should handle key with no history', async () => {
      const result = await cognitiveEnv.analyzeCausality('nonexistent.key');

      expect(result.causes).toHaveLength(0);
      expect(result.effects).toHaveLength(0);
    });

    it('should classify causal factors by type', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout');

      for (const factor of [...result.causes, ...result.effects]) {
        expect(['direct', 'indirect']).toContain(factor.type);
      }
    });

    it('should sort factors by correlation strength', async () => {
      const result = await cognitiveEnv.analyzeCausality('performance.timeout', {
        correlationThreshold: 0.1,
      });

      // Check that causes are sorted (descending)
      for (let i = 1; i < result.causes.length; i++) {
        expect(Math.abs(result.causes[i - 1].correlation)).toBeGreaterThanOrEqual(
          Math.abs(result.causes[i].correlation)
        );
      }

      // Check that effects are sorted (descending)
      for (let i = 1; i < result.effects.length; i++) {
        expect(Math.abs(result.effects[i - 1].correlation)).toBeGreaterThanOrEqual(
          Math.abs(result.effects[i].correlation)
        );
      }
    });
  });

  describe('explain()', () => {
    it('should provide basic explanation', async () => {
      const explanation = await cognitiveEnv.explain('performance.maxConnections');

      expect(explanation).toBeDefined();
      expect(explanation.key).toBe('performance.maxConnections');
      expect(explanation.value).toBe(100);
      expect(typeof explanation.text).toBe('string');
      expect(Array.isArray(explanation.reasons)).toBe(true);
      expect(explanation.reasons.length).toBeGreaterThan(0);
    });

    it('should provide detailed explanation', async () => {
      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        depth: 'detailed',
      });

      expect(explanation.text.length).toBeGreaterThan(50);
      expect(explanation.reasons.length).toBeGreaterThan(0);
    });

    it('should include history when requested', async () => {
      // Create some history
      await cognitiveEnv.setConfig('performance.maxConnections', 150);
      await cognitiveEnv.setConfig('performance.maxConnections', 200);

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        includeHistory: true,
      });

      expect(explanation.history).toBeDefined();
      expect(Array.isArray(explanation.history)).toBe(true);
    });

    it('should include impact when requested', async () => {
      // Access the key multiple times to create patterns
      for (let i = 0; i < 15; i++) {
        await cognitiveEnv.getConfig('performance.maxConnections');
      }

      cognitiveEnv.analyzeAndSuggest();

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        includeImpact: true,
      });

      expect(explanation.impact).toBeDefined();
      if (explanation.impact) {
        expect(Array.isArray(explanation.impact)).toBe(true);
      }
    });

    it('should include causality when requested', async () => {
      // Create correlated changes
      await cognitiveEnv.setConfig('performance.maxConnections', 100);
      await cognitiveEnv.setConfig('performance.timeout', 5000);
      await cognitiveEnv.setConfig('performance.maxConnections', 150);
      await cognitiveEnv.setConfig('performance.timeout', 7500);

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        includeCausality: true,
      });

      expect(explanation.causality).toBeDefined();
      if (explanation.causality) {
        expect(explanation.causality).toHaveProperty('causes');
        expect(explanation.causality).toHaveProperty('effects');
      }
    });

    it('should explain non-existent key', async () => {
      const explanation = await cognitiveEnv.explain('nonexistent.key');

      expect(explanation.value).toBeUndefined();
      expect(explanation.text).toContain('not set');
      expect(explanation.reasons).toContain('Key does not exist in the current configuration');
    });

    it('should analyze numeric values', async () => {
      const explanation = await cognitiveEnv.explain('performance.maxConnections');

      expect(explanation.reasons.some((r) => r.includes('number'))).toBe(true);
    });

    it('should identify frequently accessed keys', async () => {
      // Access key many times
      for (let i = 0; i < 20; i++) {
        await cognitiveEnv.getConfig('performance.maxConnections');
      }

      cognitiveEnv.analyzeAndSuggest();

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        depth: 'detailed',
      });

      const hasFrequentAccess = explanation.reasons.some((r) => r.includes('Frequently accessed'));
      expect(hasFrequentAccess).toBe(true);
    });

    it('should provide all optional fields when requested', async () => {
      // Setup
      await cognitiveEnv.setConfig('performance.maxConnections', 150);
      for (let i = 0; i < 15; i++) {
        await cognitiveEnv.getConfig('performance.maxConnections');
      }

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        depth: 'detailed',
        includeHistory: true,
        includeImpact: true,
        includeCausality: true,
      });

      expect(explanation.history).toBeDefined();
      expect(explanation.impact).toBeDefined();
      expect(explanation.causality).toBeDefined();
      expect(explanation.text.length).toBeGreaterThan(0);
    });
  });

  describe('Integration Tests', () => {
    it('should combine optimization and explanation', async () => {
      const optResult = await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'genetic',
        iterations: 20,
      });

      const explanation = await cognitiveEnv.explain('performance.maxConnections', {
        depth: 'detailed',
        includeHistory: true,
      });

      expect(optResult).toBeDefined();
      expect(explanation).toBeDefined();
      expect(explanation.value).toBeDefined();
    });

    it('should analyze causality after optimization', async () => {
      await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 0.7,
            target: 'maximize',
          },
          {
            metric: 'performance.timeout',
            weight: 0.3,
            target: 'minimize',
          },
        ],
        algorithm: 'genetic',
        iterations: 30,
      });

      const causality = await cognitiveEnv.analyzeCausality('performance.maxConnections');

      expect(causality).toBeDefined();
      expect(typeof causality.timestamp).toBe('number');
    });

    it('should track learning statistics', async () => {
      await cognitiveEnv.optimize({
        goals: [
          {
            metric: 'performance.maxConnections',
            weight: 1.0,
            target: 'maximize',
          },
        ],
        algorithm: 'genetic',
        iterations: 10,
      });

      await cognitiveEnv.analyzeCausality('performance.maxConnections');

      const stats = cognitiveEnv.getLearningStats();

      expect(stats.total).toBeGreaterThan(0);
      expect(stats.byType).toHaveProperty('optimization');
    });

    it('should maintain consistency across operations', async () => {
      const initialValue = env.get('performance.maxConnections');

      await cognitiveEnv.setConfig('performance.maxConnections', 200);
      const setValue = await cognitiveEnv.getConfig('performance.maxConnections');

      expect(setValue).toBe(200);
      expect(setValue).not.toBe(initialValue);
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty environment', async () => {
      const emptyEnv = new Environment({ name: 'empty', config: {} });
      const emptyCognitive = new CognitiveEnvironment(emptyEnv);

      const result = await emptyCognitive.optimize({
        goals: [{ metric: 'any', weight: 1.0, target: 'maximize' }],
        algorithm: 'genetic',
        iterations: 10,
      });

      expect(result.improved).toBe(false);
    });

    it('should handle invalid time window format', async () => {
      await expect(async () => {
        await cognitiveEnv.analyzeCausality('performance.timeout', {
          timeWindow: 'invalid',
        });
      }).rejects.toThrow('Invalid time window format');
    });

    it('should handle unknown optimization algorithm', async () => {
      await expect(async () => {
        await cognitiveEnv.optimize({
          goals: [{ metric: 'any', weight: 1.0, target: 'maximize' }],
          algorithm: 'unknown' as any,
          iterations: 10,
        });
      }).rejects.toThrow('Unknown optimization algorithm');
    });

    it('should clear cognitive data', () => {
      cognitiveEnv.analyzeAndSuggest();

      cognitiveEnv.clearCognitiveData();

      const patterns = cognitiveEnv.getAccessPatterns();
      expect(patterns).toHaveLength(0);
    });
  });
});
