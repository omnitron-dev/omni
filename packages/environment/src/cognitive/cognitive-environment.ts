/**
 * Cognitive Environment Wrapper
 * Adds cognitive capabilities to environment
 */

import { Environment } from '../core/environment.js';
import { PatternAnalyzer } from './pattern-analyzer.js';
import { LearningTracker } from './learning-tracker.js';
import { SuggestionEngine } from './suggestion-engine.js';

export class CognitiveEnvironment {
  private environment: Environment;
  private patternAnalyzer: PatternAnalyzer;
  private learningTracker: LearningTracker;
  private suggestionEngine: SuggestionEngine;

  constructor(environment: Environment) {
    this.environment = environment;
    this.patternAnalyzer = new PatternAnalyzer();
    this.learningTracker = new LearningTracker();
    this.suggestionEngine = new SuggestionEngine();
  }

  /**
   * Get configuration value (with learning)
   */
  async getConfig(key: string): Promise<unknown> {
    // Record access for pattern analysis
    this.patternAnalyzer.recordAccess(key);

    // Get value from environment
    return this.environment.get(key);
  }

  /**
   * Set configuration value (with learning)
   */
  async setConfig(key: string, value: unknown): Promise<void> {
    // Record optimization event
    this.learningTracker.record({
      type: 'optimization',
      description: `Configuration updated: ${key}`,
      metadata: { key, value },
    });

    // Set value in environment
    this.environment.set(key, value);
  }

  /**
   * Analyze patterns and generate suggestions
   */
  analyzeAndSuggest(): void {
    const patterns = this.patternAnalyzer.analyze();
    this.suggestionEngine.generateFromPatterns(patterns);

    this.learningTracker.record({
      type: 'optimization',
      description: 'Pattern analysis completed',
      metadata: { patternCount: patterns.length },
    });
  }

  /**
   * Get suggestions
   */
  getSuggestions() {
    return this.suggestionEngine.getSuggestions();
  }

  /**
   * Get access patterns
   */
  getAccessPatterns() {
    return this.patternAnalyzer.getAccessPatterns();
  }

  /**
   * Get learning statistics
   */
  getLearningStats() {
    return this.learningTracker.getStats();
  }

  /**
   * Get underlying environment
   */
  getEnvironment(): Environment {
    return this.environment;
  }

  /**
   * Clear cognitive data
   */
  clearCognitiveData(): void {
    this.patternAnalyzer.clear();
    this.learningTracker.clear();
    this.suggestionEngine.clear();
  }
}
