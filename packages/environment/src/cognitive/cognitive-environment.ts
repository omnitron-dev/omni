/**
 * Cognitive Environment Wrapper
 * Adds cognitive capabilities to environment
 */

import { Environment } from '../core/environment.js';
import { PatternAnalyzer } from './pattern-analyzer.js';
import { LearningTracker } from './learning-tracker.js';
import { SuggestionEngine } from './suggestion-engine.js';
import {
  CausalityOptions,
  CausalityResult,
  ExplainOptions,
  Explanation,
  HistoryEntry,
  OptimizationOptions,
  OptimizationResult,
} from '../types/cognitive.js';

export class CognitiveEnvironment {
  private environment: Environment;
  private patternAnalyzer: PatternAnalyzer;
  private learningTracker: LearningTracker;
  private suggestionEngine: SuggestionEngine;
  private changeHistory: Map<string, HistoryEntry[]>;

  constructor(environment: Environment) {
    this.environment = environment;
    this.patternAnalyzer = new PatternAnalyzer();
    this.learningTracker = new LearningTracker();
    this.suggestionEngine = new SuggestionEngine();
    this.changeHistory = new Map();

    // Track changes for history and causality
    this.setupChangeTracking();
  }

  /**
   * Setup change tracking
   */
  private setupChangeTracking(): void {
    this.environment.watch((event) => {
      const history = this.changeHistory.get(event.path) || [];
      history.push({
        timestamp: event.timestamp.getTime(),
        value: this.environment.get(event.path),
        operation: event.type,
      });

      // Keep only last 100 entries per key
      if (history.length > 100) {
        history.shift();
      }

      this.changeHistory.set(event.path, history);
    });
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
    this.changeHistory.clear();
  }

  /**
   * Optimize configuration for specific goals
   */
  async optimize(options: OptimizationOptions): Promise<OptimizationResult> {
    const algorithm = options.algorithm || 'genetic';
    const iterations = options.iterations || 100;

    this.learningTracker.record({
      type: 'optimization',
      description: `Starting optimization with ${algorithm} algorithm`,
      metadata: { goals: options.goals.length, iterations },
    });

    let result: OptimizationResult;

    switch (algorithm) {
      case 'genetic':
        result = await this.optimizeGenetic(options, iterations);
        break;
      case 'gradient-descent':
        result = await this.optimizeGradientDescent(options, iterations);
        break;
      case 'simulated-annealing':
        result = await this.optimizeSimulatedAnnealing(options, iterations);
        break;
      default:
        throw new Error(`Unknown optimization algorithm: ${algorithm}`);
    }

    if (result.improved) {
      this.learningTracker.record({
        type: 'optimization',
        description: 'Optimization completed successfully',
        impact: result.score,
        metadata: { changes: result.changes.length },
      });
    }

    return result;
  }

  /**
   * Genetic algorithm optimization
   */
  private async optimizeGenetic(options: OptimizationOptions, iterations: number): Promise<OptimizationResult> {
    const populationSize = options.populationSize || 20;
    const mutationRate = options.mutationRate || 0.1;
    const crossoverRate = options.crossoverRate || 0.7;

    // Get all numeric configuration keys
    const numericKeys = this.getNumericKeys();
    if (numericKeys.length === 0) {
      return {
        improved: false,
        changes: [],
        score: 0,
        iterations: 0,
        algorithm: 'genetic',
      };
    }

    // Create initial population
    let population = this.createInitialPopulation(numericKeys, populationSize);

    let bestSolution = population[0];
    let bestScore = this.evaluateSolution(bestSolution, options.goals, options.constraints);

    // Evolve population
    for (let i = 0; i < iterations; i++) {
      // Evaluate fitness
      const fitness = population.map((solution) => ({
        solution,
        score: this.evaluateSolution(solution, options.goals, options.constraints),
      }));

      // Sort by fitness
      fitness.sort((a, b) => b.score - a.score);

      // Update best solution
      if (fitness[0].score > bestScore) {
        bestSolution = fitness[0].solution;
        bestScore = fitness[0].score;
      }

      // Create new generation
      const newPopulation: Map<string, any>[] = [];

      // Elitism - keep top 10%
      const eliteCount = Math.floor(populationSize * 0.1);
      for (let j = 0; j < eliteCount; j++) {
        newPopulation.push(new Map(fitness[j].solution));
      }

      // Crossover and mutation
      while (newPopulation.length < populationSize) {
        const parent1 = this.selectParent(fitness);
        const parent2 = this.selectParent(fitness);

        let child: Map<string, any>;
        if (Math.random() < crossoverRate) {
          child = this.crossover(parent1, parent2);
        } else {
          child = new Map(parent1);
        }

        if (Math.random() < mutationRate) {
          this.mutate(child, numericKeys);
        }

        newPopulation.push(child);
      }

      population = newPopulation;
    }

    // Apply best solution and compute changes
    const changes = this.applySolution(bestSolution);

    return {
      improved: changes.length > 0 && bestScore > 0,
      changes,
      score: bestScore,
      iterations,
      algorithm: 'genetic',
    };
  }

  /**
   * Gradient descent optimization
   */
  private async optimizeGradientDescent(
    options: OptimizationOptions,
    iterations: number
  ): Promise<OptimizationResult> {
    const learningRate = 0.01;
    const numericKeys = this.getNumericKeys();

    if (numericKeys.length === 0) {
      return {
        improved: false,
        changes: [],
        score: 0,
        iterations: 0,
        algorithm: 'gradient-descent',
      };
    }

    const currentSolution = new Map<string, any>();
    for (const key of numericKeys) {
      currentSolution.set(key, this.environment.get(key));
    }

    let currentScore = this.evaluateSolution(currentSolution, options.goals, options.constraints);

    for (let i = 0; i < iterations; i++) {
      // Compute gradient for each parameter
      for (const key of numericKeys) {
        const currentValue = currentSolution.get(key);
        if (typeof currentValue !== 'number') continue;

        // Finite difference approximation
        const delta = Math.abs(currentValue) * 0.01 || 0.01;

        currentSolution.set(key, currentValue + delta);
        const scorePlus = this.evaluateSolution(currentSolution, options.goals, options.constraints);

        currentSolution.set(key, currentValue - delta);
        const scoreMinus = this.evaluateSolution(currentSolution, options.goals, options.constraints);

        const gradient = (scorePlus - scoreMinus) / (2 * delta);

        // Update value
        const newValue = currentValue + learningRate * gradient;
        currentSolution.set(key, newValue);
      }

      // Evaluate new solution
      const newScore = this.evaluateSolution(currentSolution, options.goals, options.constraints);

      if (newScore <= currentScore) {
        // No improvement, reduce learning rate
        break;
      }

      currentScore = newScore;
    }

    const changes = this.applySolution(currentSolution);

    return {
      improved: changes.length > 0 && currentScore > 0,
      changes,
      score: currentScore,
      iterations,
      algorithm: 'gradient-descent',
    };
  }

  /**
   * Simulated annealing optimization
   */
  private async optimizeSimulatedAnnealing(
    options: OptimizationOptions,
    iterations: number
  ): Promise<OptimizationResult> {
    const numericKeys = this.getNumericKeys();

    if (numericKeys.length === 0) {
      return {
        improved: false,
        changes: [],
        score: 0,
        iterations: 0,
        algorithm: 'simulated-annealing',
      };
    }

    // Current solution
    const currentSolution = new Map<string, any>();
    for (const key of numericKeys) {
      currentSolution.set(key, this.environment.get(key));
    }

    let currentScore = this.evaluateSolution(currentSolution, options.goals, options.constraints);
    let bestSolution = new Map(currentSolution);
    let bestScore = currentScore;

    // Temperature schedule
    const initialTemp = 100;
    const coolingRate = 0.95;
    let temperature = initialTemp;

    for (let i = 0; i < iterations; i++) {
      // Generate neighbor solution
      const neighbor = new Map(currentSolution);
      const randomKey = numericKeys[Math.floor(Math.random() * numericKeys.length)];
      const currentValue = neighbor.get(randomKey);

      if (typeof currentValue === 'number') {
        const perturbation = (Math.random() - 0.5) * 2 * Math.abs(currentValue) * 0.1;
        neighbor.set(randomKey, currentValue + perturbation);
      }

      const neighborScore = this.evaluateSolution(neighbor, options.goals, options.constraints);

      // Accept or reject
      const delta = neighborScore - currentScore;
      if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
        currentSolution.clear();
        neighbor.forEach((value, key) => currentSolution.set(key, value));
        currentScore = neighborScore;

        if (currentScore > bestScore) {
          bestSolution = new Map(currentSolution);
          bestScore = currentScore;
        }
      }

      // Cool down
      temperature *= coolingRate;
    }

    const changes = this.applySolution(bestSolution);

    return {
      improved: changes.length > 0 && bestScore > 0,
      changes,
      score: bestScore,
      iterations,
      algorithm: 'simulated-annealing',
    };
  }

  /**
   * Get numeric keys from environment
   */
  private getNumericKeys(): string[] {
    const keys: string[] = [];
    const data = this.environment.toObject();

    const traverse = (obj: any, prefix: string = '') => {
      for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'number') {
          keys.push(fullKey);
        } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
          traverse(value, fullKey);
        }
      }
    };

    traverse(data);
    return keys;
  }

  /**
   * Create initial population for genetic algorithm
   */
  private createInitialPopulation(keys: string[], size: number): Map<string, any>[] {
    const population: Map<string, any>[] = [];

    // Add current configuration
    const current = new Map<string, any>();
    for (const key of keys) {
      current.set(key, this.environment.get(key));
    }
    population.push(current);

    // Generate random variations
    for (let i = 1; i < size; i++) {
      const individual = new Map<string, any>();
      for (const key of keys) {
        const currentValue = this.environment.get(key);
        if (typeof currentValue === 'number') {
          // Random variation ±50%
          const variation = (Math.random() - 0.5) * currentValue;
          individual.set(key, currentValue + variation);
        } else {
          individual.set(key, currentValue);
        }
      }
      population.push(individual);
    }

    return population;
  }

  /**
   * Evaluate solution fitness
   */
  private evaluateSolution(
    solution: Map<string, any>,
    goals: OptimizationOptions['goals'],
    constraints?: OptimizationOptions['constraints']
  ): number {
    let totalScore = 0;

    // Check constraints
    if (constraints) {
      for (const constraint of constraints) {
        const value = solution.get(constraint.key);
        if (typeof value !== 'number') continue;

        let satisfied = true;
        switch (constraint.type) {
          case 'min':
            satisfied = value >= (constraint.value as number);
            break;
          case 'max':
            satisfied = value <= (constraint.value as number);
            break;
          case 'equals':
            satisfied = value === (constraint.value as number);
            break;
          case 'range':
            const [min, max] = constraint.value as [number, number];
            satisfied = value >= min && value <= max;
            break;
        }

        if (!satisfied) {
          return -Infinity; // Constraint violation
        }
      }
    }

    // Evaluate goals
    for (const goal of goals) {
      const value = solution.get(goal.metric);
      if (value === undefined) continue;

      let metricScore: number;

      if (goal.evaluator) {
        metricScore = goal.evaluator(value);
      } else if (typeof value === 'number') {
        metricScore = value;
      } else {
        continue;
      }

      // Apply target direction
      if (goal.target === 'minimize') {
        metricScore = -metricScore;
      }

      totalScore += metricScore * goal.weight;
    }

    return totalScore;
  }

  /**
   * Select parent using tournament selection
   */
  private selectParent(fitness: Array<{ solution: Map<string, any>; score: number }>): Map<string, any> {
    const tournamentSize = 3;
    let best = fitness[Math.floor(Math.random() * fitness.length)];

    for (let i = 1; i < tournamentSize; i++) {
      const competitor = fitness[Math.floor(Math.random() * fitness.length)];
      if (competitor.score > best.score) {
        best = competitor;
      }
    }

    return best.solution;
  }

  /**
   * Crossover two solutions
   */
  private crossover(parent1: Map<string, any>, parent2: Map<string, any>): Map<string, any> {
    const child = new Map<string, any>();
    const keys = Array.from(parent1.keys());

    for (const key of keys) {
      // Random selection from parents
      if (Math.random() < 0.5) {
        child.set(key, parent1.get(key));
      } else {
        child.set(key, parent2.get(key));
      }
    }

    return child;
  }

  /**
   * Mutate solution
   */
  private mutate(solution: Map<string, any>, keys: string[]): void {
    const mutationKey = keys[Math.floor(Math.random() * keys.length)];
    const currentValue = solution.get(mutationKey);

    if (typeof currentValue === 'number') {
      const mutation = (Math.random() - 0.5) * 2 * Math.abs(currentValue) * 0.2;
      solution.set(mutationKey, currentValue + mutation);
    }
  }

  /**
   * Apply solution to environment and track changes
   */
  private applySolution(solution: Map<string, any>): OptimizationResult['changes'] {
    const changes: OptimizationResult['changes'] = [];

    for (const [key, newValue] of solution) {
      const oldValue = this.environment.get(key);

      if (oldValue !== newValue) {
        this.environment.set(key, newValue);

        const improvement = typeof newValue === 'number' && typeof oldValue === 'number' ? newValue - oldValue : 0;

        changes.push({
          key,
          oldValue,
          newValue,
          improvement,
        });
      }
    }

    return changes;
  }

  /**
   * Analyze causal relationships
   */
  async analyzeCausality(key: string, options: CausalityOptions = {}): Promise<CausalityResult> {
    const correlationThreshold = options.correlationThreshold || 0.5;
    const timeWindow = options.timeWindow ? this.parseTimeWindow(options.timeWindow) : undefined;

    const keyHistory = this.changeHistory.get(key);
    if (!keyHistory || keyHistory.length < 2) {
      return {
        key,
        causes: [],
        effects: [],
        timestamp: Date.now(),
      };
    }

    const causes: CausalityResult['causes'] = [];
    const effects: CausalityResult['effects'] = [];

    // Analyze correlation with other keys
    for (const [otherKey, otherHistory] of this.changeHistory) {
      if (otherKey === key || otherHistory.length < 2) continue;

      const correlation = this.computeCorrelation(keyHistory, otherHistory, timeWindow);

      if (Math.abs(correlation) >= correlationThreshold) {
        const strength = this.classifyStrength(Math.abs(correlation));
        const evidence = this.buildEvidence(key, otherKey, keyHistory, otherHistory);

        const factor = {
          key: otherKey,
          correlation,
          strength,
          type: 'direct' as const,
          evidence,
        };

        // Positive correlation means other changes before this (cause)
        // Negative correlation means this changes before other (effect)
        if (correlation > 0) {
          causes.push(factor);
        } else {
          effects.push(factor);
        }
      }
    }

    this.learningTracker.record({
      type: 'prediction',
      description: `Causality analysis for ${key}`,
      metadata: { causes: causes.length, effects: effects.length },
    });

    return {
      key,
      causes: causes.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
      effects: effects.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)),
      timestamp: Date.now(),
    };
  }

  /**
   * Parse time window string (e.g., "1h", "30m", "7d")
   */
  private parseTimeWindow(window: string): number {
    const match = window.match(/^(\d+)(ms|s|m|h|d)$/);
    if (!match) {
      throw new Error(`Invalid time window format: ${window}`);
    }

    const value = parseInt(match[1], 10);
    const unit = match[2];

    const multipliers: Record<string, number> = {
      ms: 1,
      s: 1000,
      m: 60 * 1000,
      h: 60 * 60 * 1000,
      d: 24 * 60 * 60 * 1000,
    };

    return value * multipliers[unit];
  }

  /**
   * Compute correlation between two time series
   */
  private computeCorrelation(
    history1: HistoryEntry[],
    history2: HistoryEntry[],
    timeWindow?: number
  ): number {
    // Filter by time window if specified
    const now = Date.now();
    const h1 = timeWindow ? history1.filter((e) => now - e.timestamp <= timeWindow) : history1;
    const h2 = timeWindow ? history2.filter((e) => now - e.timestamp <= timeWindow) : history2;

    if (h1.length < 2 || h2.length < 2) return 0;

    // Convert values to numbers
    const values1 = h1
      .map((e) => (typeof e.value === 'number' ? e.value : 0))
      .filter((v) => !isNaN(v) && isFinite(v));
    const values2 = h2
      .map((e) => (typeof e.value === 'number' ? e.value : 0))
      .filter((v) => !isNaN(v) && isFinite(v));

    if (values1.length < 2 || values2.length < 2) return 0;

    // Use shorter length
    const n = Math.min(values1.length, values2.length);
    const v1 = values1.slice(-n);
    const v2 = values2.slice(-n);

    // Compute Pearson correlation
    const mean1 = v1.reduce((a, b) => a + b, 0) / n;
    const mean2 = v2.reduce((a, b) => a + b, 0) / n;

    let num = 0;
    let den1 = 0;
    let den2 = 0;

    for (let i = 0; i < n; i++) {
      const diff1 = v1[i] - mean1;
      const diff2 = v2[i] - mean2;
      num += diff1 * diff2;
      den1 += diff1 * diff1;
      den2 += diff2 * diff2;
    }

    const denominator = Math.sqrt(den1 * den2);
    if (denominator === 0) return 0;

    return num / denominator;
  }

  /**
   * Classify correlation strength
   */
  private classifyStrength(correlation: number): 'weak' | 'moderate' | 'strong' {
    if (correlation >= 0.7) return 'strong';
    if (correlation >= 0.4) return 'moderate';
    return 'weak';
  }

  /**
   * Build evidence for causal relationship
   */
  private buildEvidence(key1: string, key2: string, history1: HistoryEntry[], history2: HistoryEntry[]): string[] {
    const evidence: string[] = [];

    // Count co-occurrences
    let coOccurrences = 0;
    const threshold = 1000; // 1 second

    for (const entry1 of history1) {
      for (const entry2 of history2) {
        if (Math.abs(entry1.timestamp - entry2.timestamp) < threshold) {
          coOccurrences++;
        }
      }
    }

    if (coOccurrences > 0) {
      evidence.push(`${coOccurrences} co-occurrences within 1 second`);
    }

    // Check temporal ordering
    const avgTime1 = history1.reduce((sum, e) => sum + e.timestamp, 0) / history1.length;
    const avgTime2 = history2.reduce((sum, e) => sum + e.timestamp, 0) / history2.length;

    if (avgTime1 < avgTime2) {
      evidence.push(`${key1} typically changes before ${key2}`);
    } else {
      evidence.push(`${key2} typically changes before ${key1}`);
    }

    return evidence;
  }

  /**
   * Enhanced explanation with causality and history
   */
  async explain(key: string, options: ExplainOptions = {}): Promise<Explanation> {
    const depth = options.depth || 'brief';
    const value = this.environment.get(key);

    // Get basic info
    const reasons: string[] = [];
    const impact: string[] = [];

    // Check if value exists
    if (value === undefined) {
      return {
        key,
        value,
        text: `Configuration key '${key}' is not set.`,
        reasons: ['Key does not exist in the current configuration'],
      };
    }

    // Analyze value
    const valueType = typeof value;
    reasons.push(`Value is of type '${valueType}'`);

    if (valueType === 'number') {
      const numericKeys = this.getNumericKeys();
      const avgValue =
        numericKeys
          .map((k) => this.environment.get(k))
          .filter((v) => typeof v === 'number')
          .reduce((sum: number, v: number) => sum + v, 0) / numericKeys.length || 1;

      if (value > avgValue * 1.5) {
        reasons.push('Value is significantly higher than average');
      } else if (value < avgValue * 0.5) {
        reasons.push('Value is significantly lower than average');
      }
    }

    // Get access patterns
    const patterns = this.patternAnalyzer.getAccessPatterns();
    const pattern = patterns.find((p) => p.key === key);

    if (pattern) {
      if (pattern.count > 10) {
        reasons.push(`Frequently accessed (${pattern.count} times)`);
        impact.push('Changes to this value affect performance significantly');
      }

      if (pattern.avgInterval < 1000) {
        reasons.push('Accessed in rapid succession');
        impact.push('High-frequency access suggests critical configuration');
      }
    }

    // Get history if requested
    let history: HistoryEntry[] | undefined;
    if (options.includeHistory) {
      history = this.changeHistory.get(key)?.slice(-10); // Last 10 changes

      if (history && history.length > 0) {
        reasons.push(`Changed ${history.length} times recently`);

        const recentChanges = history.filter((e) => Date.now() - e.timestamp < 3600000);
        if (recentChanges.length > 3) {
          impact.push('Frequently modified, may be unstable');
        }
      }
    }

    // Get causality if requested
    let causality: CausalityResult | undefined;
    if (options.includeCausality) {
      causality = await this.analyzeCausality(key, {});

      if (causality.causes.length > 0) {
        const strongCauses = causality.causes.filter((c) => c.strength === 'strong');
        if (strongCauses.length > 0) {
          reasons.push(`Strongly influenced by: ${strongCauses.map((c) => c.key).join(', ')}`);
        }
      }

      if (causality.effects.length > 0) {
        const strongEffects = causality.effects.filter((e) => e.strength === 'strong');
        if (strongEffects.length > 0) {
          impact.push(`Strongly influences: ${strongEffects.map((e) => e.key).join(', ')}`);
        }
      }
    }

    // Build explanation text
    let text = `Configuration '${key}' has value '${JSON.stringify(value)}'.`;

    if (depth === 'detailed') {
      text += ` ${reasons.join('. ')}.`;
      if (impact.length > 0) {
        text += ` Impact: ${impact.join('. ')}.`;
      }
    }

    return {
      key,
      value,
      text,
      reasons,
      impact: options.includeImpact ? impact : undefined,
      history: options.includeHistory ? history : undefined,
      causality: options.includeCausality ? causality : undefined,
    };
  }
}
