import { describe, it, expect, beforeEach } from 'vitest';
import { Environment } from '../../../src/core/environment.js';
import { CognitiveEnvironment } from '../../../src/cognitive/cognitive-environment.js';

describe('CognitiveEnvironment', () => {
  let env: Environment;
  let cogEnv: CognitiveEnvironment;

  beforeEach(async () => {
    env = await Environment.create({ name: 'test' });
    cogEnv = new CognitiveEnvironment(env);
  });

  it('should track config accesses', async () => {
    await env.config.set('test-key', 'value');
    await cogEnv.getConfig('test-key');
    const patterns = cogEnv.getAccessPatterns();
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('should record learning events', async () => {
    await cogEnv.setConfig('key1', 'value1');
    const stats = cogEnv.getLearningStats();
    expect(stats.total).toBeGreaterThan(0);
  });

  it('should generate suggestions', async () => {
    // Simulate frequent access
    for (let i = 0; i < 15; i++) {
      await cogEnv.getConfig('frequent-key');
    }
    cogEnv.analyzeAndSuggest();
    const suggestions = cogEnv.getSuggestions();
    expect(suggestions).toBeDefined();
  });

  it('should access underlying environment', () => {
    expect(cogEnv.getEnvironment()).toBe(env);
  });

  it('should clear cognitive data', async () => {
    await cogEnv.getConfig('key1');
    cogEnv.clearCognitiveData();
    expect(cogEnv.getAccessPatterns()).toHaveLength(0);
  });
});
