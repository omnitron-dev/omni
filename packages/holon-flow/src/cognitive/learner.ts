/**
 * Universal Learner - Adaptive learning across multiple strategies
 */

import type { Pattern } from './knowledge.js';
import type { ProcessedExample } from './index.js';

/**
 * Learning strategy interface
 */
export interface LearningStrategy {
  name: string;
  canLearn(examples: ProcessedExample<any, any>[]): boolean;
  learn(examples: ProcessedExample<any, any>[]): Promise<LearnedModel>;
  scorePatterns(characteristics: PatternCharacteristics): number;
  createModel(patterns: Pattern[]): Promise<LearnedModel>;
  updateModel(model: LearnedModel, patterns: Pattern[]): Promise<void>;
}

/**
 * Learned model
 */
export interface LearnedModel {
  id: string;
  type: string;
  strategy: string;
  accuracy: number;
  confidence: number;
  data: Map<string, any>;
  predict: (input: any) => any;
  metadata: Record<string, any>;
}

/**
 * Pattern characteristics
 */
export interface PatternCharacteristics {
  statistical: boolean;
  structural: boolean;
  temporal: boolean;
  causal: boolean;
  symbolic: boolean;
  complexity: number;
  dataSize: number;
}

/**
 * Validation result
 */
export interface ValidationResult {
  accuracy: number;
  precision: number;
  recall: number;
  f1Score: number;
  confusionMatrix?: number[][];
}

/**
 * Universal learner with multiple strategies
 */
export class UniversalLearner {
  private strategies: LearningStrategy[] = [];
  private models: Map<string, LearnedModel> = new Map();
  private activeStrategy: LearningStrategy | null = null;

  constructor() {
    // Register built-in strategies
    this.registerStrategy(new PatternMatchingStrategy());
    this.registerStrategy(new StatisticalStrategy());
    this.registerStrategy(new RuleLearningStrategy());
  }

  /**
   * Register a learning strategy
   */
  registerStrategy(strategy: LearningStrategy): void {
    this.strategies.push(strategy);
  }

  /**
   * Extract patterns from examples
   */
  async extractPatterns(examples: ProcessedExample<any, any>[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Extract statistical patterns
    const statistical = await this.extractStatisticalPatterns(examples);
    patterns.push(...statistical);

    // Extract structural patterns
    const structural = await this.extractStructuralPatterns(examples);
    patterns.push(...structural);

    // Extract frequency patterns
    const frequency = await this.extractFrequencyPatterns(examples);
    patterns.push(...frequency);

    return patterns;
  }

  /**
   * Update model with new patterns
   */
  async updateModel(patterns: Pattern[]): Promise<void> {
    // Select best strategy for these patterns
    const strategy = this.selectStrategy(patterns);
    this.activeStrategy = strategy;

    // Create or update model
    const modelId = this.generateModelId(patterns);
    let model = this.models.get(modelId);

    if (!model) {
      model = await strategy.createModel(patterns);
      this.models.set(modelId, model);
    } else {
      await strategy.updateModel(model, patterns);
    }
  }

  /**
   * Get active model
   */
  getModel(id: string): LearnedModel | undefined {
    return this.models.get(id);
  }

  /**
   * Select best strategy for patterns
   */
  private selectStrategy(patterns: Pattern[]): LearningStrategy {
    const characteristics = this.analyzePatterns(patterns);

    // Score each strategy
    const scores = this.strategies.map((s) => ({
      strategy: s,
      score: s.scorePatterns(characteristics),
    }));

    // Select highest scoring
    scores.sort((a, b) => b.score - a.score);

    if (scores.length === 0 || !scores[0]) {
      throw new Error('No learning strategy available');
    }

    return scores[0].strategy;
  }

  /**
   * Analyze pattern characteristics
   */
  private analyzePatterns(patterns: Pattern[]): PatternCharacteristics {
    return {
      statistical: patterns.some((p) => p.type === 'statistical'),
      structural: patterns.some((p) => p.type === 'structural'),
      temporal: patterns.some((p) => p.type === 'temporal'),
      causal: patterns.some((p) => p.type === 'causal'),
      symbolic: patterns.some((p) => p.type === 'symbolic'),
      complexity: this.calculateComplexity(patterns),
      dataSize: patterns.length,
    };
  }

  /**
   * Calculate pattern complexity
   */
  private calculateComplexity(patterns: Pattern[]): number {
    // Simple heuristic: average confidence inverse
    const avgConfidence = patterns.reduce((sum, p) => sum + p.confidence, 0) / patterns.length;
    return 1 - avgConfidence;
  }

  /**
   * Generate model ID from patterns
   */
  private generateModelId(patterns: Pattern[]): string {
    const types = patterns.map((p) => p.type).join('-');
    return `model-${types}-${Date.now()}`;
  }

  /**
   * Extract statistical patterns
   */
  private async extractStatisticalPatterns(examples: ProcessedExample<any, any>[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    if (examples.length < 2) return patterns;

    // Calculate basic statistics
    const values = examples.map((e) => {
      if (typeof e.output === 'number') return e.output;
      return 0;
    });

    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    patterns.push({
      id: `stat-mean-${Date.now()}`,
      type: 'statistical',
      description: `Mean value: ${mean.toFixed(2)}`,
      confidence: 0.8,
      occurrences: examples.length,
      data: new Map([
        ['mean', mean],
        ['variance', variance],
        ['stdDev', stdDev],
      ]),
    });

    return patterns;
  }

  /**
   * Extract structural patterns
   */
  private async extractStructuralPatterns(examples: ProcessedExample<any, any>[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Analyze input/output structure
    const inputTypes = new Map<string, number>();
    const outputTypes = new Map<string, number>();

    for (const example of examples) {
      const inputType = typeof example.input;
      const outputType = typeof example.output;

      inputTypes.set(inputType, (inputTypes.get(inputType) ?? 0) + 1);
      outputTypes.set(outputType, (outputTypes.get(outputType) ?? 0) + 1);
    }

    // Create pattern for dominant type mapping
    const dominantInputType = this.getDominantType(inputTypes);
    const dominantOutputType = this.getDominantType(outputTypes);

    if (dominantInputType && dominantOutputType) {
      patterns.push({
        id: `struct-type-${Date.now()}`,
        type: 'structural',
        description: `Maps ${dominantInputType} to ${dominantOutputType}`,
        confidence: 0.9,
        occurrences: examples.length,
        data: new Map([
          ['inputType', dominantInputType],
          ['outputType', dominantOutputType],
        ]),
      });
    }

    return patterns;
  }

  /**
   * Extract frequency patterns
   */
  private async extractFrequencyPatterns(examples: ProcessedExample<any, any>[]): Promise<Pattern[]> {
    const patterns: Pattern[] = [];

    // Count output frequencies
    const outputCounts = new Map<string, number>();

    for (const example of examples) {
      const key = JSON.stringify(example.output);
      outputCounts.set(key, (outputCounts.get(key) ?? 0) + 1);
    }

    // Find frequent outputs
    for (const [output, count] of outputCounts.entries()) {
      if (count >= 2) {
        // At least 2 occurrences
        patterns.push({
          id: `freq-${Date.now()}-${output}`,
          type: 'frequency',
          description: `Output ${output} occurs ${count} times`,
          confidence: count / examples.length,
          occurrences: count,
          data: new Map<string, any>([
            ['output', output],
            ['frequency', count / examples.length],
          ]),
        });
      }
    }

    return patterns;
  }

  /**
   * Get dominant type from type counts
   */
  private getDominantType(typeCounts: Map<string, number>): string | null {
    let maxCount = 0;
    let dominantType: string | null = null;

    for (const [type, count] of typeCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        dominantType = type;
      }
    }

    return dominantType;
  }

  /**
   * Extract skills from patterns
   */
  extractSkills(patterns: Pattern[]): any[] {
    // Simple skill extraction based on patterns
    return patterns
      .filter((p) => p.confidence > 0.7)
      .map((p) => ({
        id: p.id,
        name: p.description,
        description: `Skill learned from ${p.type} pattern`,
        confidence: p.confidence,
      }));
  }

  /**
   * Adapt strategy based on validation
   */
  async adaptStrategy(validation: ValidationResult): Promise<void> {
    // Simple adaptation: if accuracy is low, try next strategy
    if (validation.accuracy < 0.5 && this.strategies.length > 1) {
      const currentIndex = this.strategies.indexOf(this.activeStrategy!);
      const nextIndex = (currentIndex + 1) % this.strategies.length;
      this.activeStrategy = this.strategies[nextIndex]!;
    }
  }
}

/**
 * Pattern matching learning strategy
 */
class PatternMatchingStrategy implements LearningStrategy {
  name = 'pattern-matching';

  canLearn(examples: ProcessedExample<any, any>[]): boolean {
    return examples.length >= 2;
  }

  async learn(examples: ProcessedExample<any, any>[]): Promise<LearnedModel> {
    // Build lookup table
    const lookupTable = new Map<string, any>();

    for (const example of examples) {
      const key = JSON.stringify(example.input);
      lookupTable.set(key, example.output);
    }

    return {
      id: `pattern-matching-${Date.now()}`,
      type: 'lookup',
      strategy: this.name,
      accuracy: 1.0, // Perfect on training data
      confidence: 0.8,
      data: lookupTable,
      predict: (input: any) => {
        const key = JSON.stringify(input);
        return lookupTable.get(key);
      },
      metadata: {
        exampleCount: examples.length,
      },
    };
  }

  scorePatterns(characteristics: PatternCharacteristics): number {
    // Good for small datasets and exact matching
    if (characteristics.dataSize < 100) {
      return 0.8;
    }
    return 0.3;
  }

  async createModel(patterns: Pattern[]): Promise<LearnedModel> {
    const data = new Map<string, any>();

    for (const pattern of patterns) {
      data.set(pattern.id, pattern.data);
    }

    return {
      id: `pattern-model-${Date.now()}`,
      type: 'pattern-based',
      strategy: this.name,
      accuracy: 0.8,
      confidence: 0.75,
      data,
      predict: (input: any) => {
        // Simple prediction based on patterns
        return input;
      },
      metadata: { patternCount: patterns.length },
    };
  }

  async updateModel(model: LearnedModel, patterns: Pattern[]): Promise<void> {
    // Merge new patterns
    for (const pattern of patterns) {
      model.data.set(pattern.id, pattern.data);
    }
  }
}

/**
 * Statistical learning strategy
 */
class StatisticalStrategy implements LearningStrategy {
  name = 'statistical';

  canLearn(examples: ProcessedExample<any, any>[]): boolean {
    return examples.length >= 10 && examples.every((e) => typeof e.output === 'number');
  }

  async learn(examples: ProcessedExample<any, any>[]): Promise<LearnedModel> {
    // Calculate statistics
    const values = examples.map((e) => e.output as number);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    return {
      id: `statistical-${Date.now()}`,
      type: 'statistical',
      strategy: this.name,
      accuracy: 0.7,
      confidence: 0.8,
      data: new Map([['mean', mean]]),
      predict: () => mean,
      metadata: {
        exampleCount: examples.length,
      },
    };
  }

  scorePatterns(characteristics: PatternCharacteristics): number {
    if (characteristics.statistical && characteristics.dataSize >= 10) {
      return 0.9;
    }
    return 0.4;
  }

  async createModel(patterns: Pattern[]): Promise<LearnedModel> {
    const statisticalPatterns = patterns.filter((p) => p.type === 'statistical');

    return {
      id: `stat-model-${Date.now()}`,
      type: 'statistical',
      strategy: this.name,
      accuracy: 0.75,
      confidence: 0.8,
      data: new Map(statisticalPatterns.map((p) => [p.id, p.data])),
      predict: (input: any) => input,
      metadata: { patternCount: statisticalPatterns.length },
    };
  }

  async updateModel(model: LearnedModel, patterns: Pattern[]): Promise<void> {
    const statisticalPatterns = patterns.filter((p) => p.type === 'statistical');
    for (const pattern of statisticalPatterns) {
      model.data.set(pattern.id, pattern.data);
    }
  }
}

/**
 * Rule learning strategy
 */
class RuleLearningStrategy implements LearningStrategy {
  name = 'rule-learning';

  canLearn(examples: ProcessedExample<any, any>[]): boolean {
    return examples.length >= 5;
  }

  async learn(examples: ProcessedExample<any, any>[]): Promise<LearnedModel> {
    // Extract simple rules
    const rules: Array<{ condition: (input: any) => boolean; output: any }> = [];

    // Simple rule: if input matches, use output
    for (const example of examples) {
      rules.push({
        condition: (input: any) => JSON.stringify(input) === JSON.stringify(example.input),
        output: example.output,
      });
    }

    return {
      id: `rule-${Date.now()}`,
      type: 'rule-based',
      strategy: this.name,
      accuracy: 0.85,
      confidence: 0.8,
      data: new Map([['rules', rules]]),
      predict: (input: any) => {
        for (const rule of rules) {
          if (rule.condition(input)) {
            return rule.output;
          }
        }
        return undefined;
      },
      metadata: {
        ruleCount: rules.length,
      },
    };
  }

  scorePatterns(characteristics: PatternCharacteristics): number {
    if (characteristics.structural || characteristics.symbolic) {
      return 0.85;
    }
    return 0.5;
  }

  async createModel(patterns: Pattern[]): Promise<LearnedModel> {
    return {
      id: `rule-model-${Date.now()}`,
      type: 'rule-based',
      strategy: this.name,
      accuracy: 0.8,
      confidence: 0.75,
      data: new Map(patterns.map((p) => [p.id, p.data])),
      predict: (input: any) => input,
      metadata: { patternCount: patterns.length },
    };
  }

  async updateModel(model: LearnedModel, patterns: Pattern[]): Promise<void> {
    for (const pattern of patterns) {
      model.data.set(pattern.id, pattern.data);
    }
  }
}
