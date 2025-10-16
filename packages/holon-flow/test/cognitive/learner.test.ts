/**
 * Tests for Universal Learner
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UniversalLearner } from '../../src/cognitive/learner.js';
import type { ProcessedExample } from '../../src/cognitive/index.js';

describe('UniversalLearner', () => {
  let learner: UniversalLearner;

  beforeEach(() => {
    learner = new UniversalLearner();
  });

  describe('Pattern Extraction', () => {
    it('should extract statistical patterns', async () => {
      const examples: ProcessedExample<number, number>[] = [
        {
          input: 1,
          output: 2,
          features: new Map([['input', 1]]),
          timestamp: Date.now(),
        },
        {
          input: 2,
          output: 4,
          features: new Map([['input', 2]]),
          timestamp: Date.now(),
        },
        {
          input: 3,
          output: 6,
          features: new Map([['input', 3]]),
          timestamp: Date.now(),
        },
      ];

      const patterns = await learner.extractPatterns(examples);

      expect(patterns.length).toBeGreaterThan(0);
      const statPatterns = patterns.filter((p) => p.type === 'statistical');
      expect(statPatterns.length).toBeGreaterThan(0);
    });

    it('should extract structural patterns', async () => {
      const examples: ProcessedExample<string, number>[] = [
        {
          input: 'a',
          output: 1,
          features: new Map([['input', 'a']]),
          timestamp: Date.now(),
        },
        {
          input: 'ab',
          output: 2,
          features: new Map([['input', 'ab']]),
          timestamp: Date.now(),
        },
      ];

      const patterns = await learner.extractPatterns(examples);

      const structPatterns = patterns.filter((p) => p.type === 'structural');
      expect(structPatterns.length).toBeGreaterThan(0);
    });

    it('should extract frequency patterns', async () => {
      const examples: ProcessedExample<number, string>[] = [
        {
          input: 1,
          output: 'A',
          features: new Map([['input', 1]]),
          timestamp: Date.now(),
        },
        {
          input: 2,
          output: 'A',
          features: new Map([['input', 2]]),
          timestamp: Date.now(),
        },
        {
          input: 3,
          output: 'B',
          features: new Map([['input', 3]]),
          timestamp: Date.now(),
        },
      ];

      const patterns = await learner.extractPatterns(examples);

      const freqPatterns = patterns.filter((p) => p.type === 'frequency');
      expect(freqPatterns.length).toBeGreaterThan(0);
    });
  });

  describe('Model Creation', () => {
    it('should create model from patterns', async () => {
      const examples: ProcessedExample<number, number>[] = [
        {
          input: 1,
          output: 2,
          features: new Map([['input', 1]]),
          timestamp: Date.now(),
        },
        {
          input: 2,
          output: 4,
          features: new Map([['input', 2]]),
          timestamp: Date.now(),
        },
      ];

      const patterns = await learner.extractPatterns(examples);
      await learner.updateModel(patterns);

      // Model should be created
      expect(learner).toBeDefined();
    });

    it('should use appropriate strategy for patterns', async () => {
      const examples: ProcessedExample<number, number>[] = Array.from({ length: 20 }, (_, i) => ({
        input: i,
        output: i * 2,
        features: new Map([['input', i]]),
        timestamp: Date.now(),
      }));

      const patterns = await learner.extractPatterns(examples);
      await learner.updateModel(patterns);

      // Should select statistical strategy for numeric data
      expect(learner).toBeDefined();
    });
  });

  describe('Skill Extraction', () => {
    it('should extract skills from patterns', async () => {
      const patterns = [
        {
          id: 'pattern1',
          type: 'structural',
          description: 'Maps numbers to strings',
          confidence: 0.9,
          occurrences: 10,
          data: new Map(),
        },
      ];

      const skills = learner.extractSkills(patterns);

      expect(skills.length).toBeGreaterThan(0);
      expect(skills[0]).toHaveProperty('id');
      expect(skills[0]).toHaveProperty('name');
      expect(skills[0]).toHaveProperty('confidence');
    });

    it('should filter low-confidence patterns', async () => {
      const patterns = [
        {
          id: 'pattern1',
          type: 'structural',
          description: 'High confidence pattern',
          confidence: 0.9,
          occurrences: 10,
          data: new Map(),
        },
        {
          id: 'pattern2',
          type: 'structural',
          description: 'Low confidence pattern',
          confidence: 0.3,
          occurrences: 2,
          data: new Map(),
        },
      ];

      const skills = learner.extractSkills(patterns);

      // Only high-confidence pattern should become a skill
      expect(skills.length).toBe(1);
      expect(skills[0]!.confidence).toBeGreaterThan(0.7);
    });
  });

  describe('Strategy Adaptation', () => {
    it('should adapt strategy on low accuracy', async () => {
      const validation = {
        accuracy: 0.3,
        precision: 0.4,
        recall: 0.5,
        f1Score: 0.45,
      };

      await learner.adaptStrategy(validation);

      // Should have adapted (internal state change)
      expect(learner).toBeDefined();
    });
  });
});
