import { describe, it, expect, beforeEach } from 'vitest';
import { PatternAnalyzer } from '../../../src/cognitive/pattern-analyzer.js';

describe('PatternAnalyzer', () => {
  let analyzer: PatternAnalyzer;

  beforeEach(() => {
    analyzer = new PatternAnalyzer();
  });

  it('should record accesses', () => {
    analyzer.recordAccess('key1');
    const patterns = analyzer.getAccessPatterns();
    expect(patterns).toHaveLength(1);
    expect(patterns[0].key).toBe('key1');
    expect(patterns[0].count).toBe(1);
  });

  it('should track multiple accesses', () => {
    for (let i = 0; i < 5; i++) {
      analyzer.recordAccess('key1');
    }
    const patterns = analyzer.getAccessPatterns();
    expect(patterns[0].count).toBe(5);
  });

  it('should analyze patterns', () => {
    for (let i = 0; i < 15; i++) {
      analyzer.recordAccess('frequent-key');
    }
    const patterns = analyzer.analyze();
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('should sort by frequency', () => {
    analyzer.recordAccess('key1');
    analyzer.recordAccess('key2');
    analyzer.recordAccess('key2');
    const patterns = analyzer.getAccessPatterns();
    expect(patterns[0].key).toBe('key2');
  });

  it('should clear data', () => {
    analyzer.recordAccess('key1');
    analyzer.clear();
    expect(analyzer.getAccessPatterns()).toHaveLength(0);
  });
});
