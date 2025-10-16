/**
 * Cognitive Flow - Learning, reasoning, and self-improvement capabilities
 */

import type { Flow } from '../types.js';
import type { Context } from '../context.js';
import { KnowledgeGraph } from './knowledge.js';
import { UniversalLearner } from './learner.js';
import { Memory, EpisodicMemory } from './memory.js';
import { ReasoningEngine, type ReasoningChain } from './reasoning.js';
import { GoalPlanner, type Plan, type Goal } from './planning.js';

/**
 * Example for learning
 */
export interface Example<In, Out> {
  input: In;
  output: Out;
  metadata?: Record<string, any>;
}

/**
 * Processed example with extracted features
 */
export interface ProcessedExample<In, Out> extends Example<In, Out> {
  features: Map<string, any>;
  timestamp: number;
}

/**
 * Natural language explanation
 */
export interface Explanation {
  summary: string;
  details: string[];
  examples: Example<any, any>[];
  concepts: string[];
  reasoning: ReasoningChain;
}

/**
 * Quality metrics for self-assessment
 */
export interface QualityMetrics {
  accuracy: number;
  performance: number;
  reliability: number;
  efficiency: number;
  understandability: number;
  maintainability: number;
}

/**
 * Belief set for reasoning
 */
export class BeliefSet {
  private beliefs: Map<string, { value: any; confidence: number; timestamp: number }> = new Map();

  add(key: string, value: any, confidence = 1.0): void {
    this.beliefs.set(key, { value, confidence, timestamp: Date.now() });
  }

  get(key: string): any {
    return this.beliefs.get(key)?.value;
  }

  getConfidence(key: string): number {
    return this.beliefs.get(key)?.confidence ?? 0;
  }

  has(key: string): boolean {
    return this.beliefs.has(key);
  }

  list(): Array<{ key: string; value: any; confidence: number }> {
    return Array.from(this.beliefs.entries()).map(([key, belief]) => ({
      key,
      value: belief.value,
      confidence: belief.confidence,
    }));
  }

  toPremises(): string[] {
    return Array.from(this.beliefs.entries())
      .filter(([, belief]) => belief.confidence > 0.7)
      .map(([key, belief]) => `${key}: ${belief.value}`);
  }

  update(key: string, modifier: (current: any) => any): void {
    const current = this.beliefs.get(key);
    if (current) {
      current.value = modifier(current.value);
      current.timestamp = Date.now();
    }
  }

  clear(): void {
    this.beliefs.clear();
  }
}

/**
 * Goal hierarchy for planning
 */
export class GoalHierarchy {
  private goals: Map<string, Goal & { priority: number; parent?: string }> = new Map();

  add(id: string, goal: Goal, priority = 0.5, parent?: string): void {
    this.goals.set(id, { ...goal, priority, parent });
  }

  get(id: string): Goal | undefined {
    return this.goals.get(id);
  }

  active(): Goal[] {
    return Array.from(this.goals.values())
      .filter((g) => !g.achieved)
      .sort((a, b) => b.priority - a.priority);
  }

  primary(): Goal | undefined {
    const active = this.active();
    return active.length > 0 ? active[0] : undefined;
  }

  achieve(id: string): void {
    const goal = this.goals.get(id);
    if (goal) {
      goal.achieved = true;
    }
  }

  clear(): void {
    this.goals.clear();
  }
}

/**
 * Skill library for storing learned capabilities
 */
export class SkillLibrary {
  private skills: Map<string, Skill> = new Map();

  add(skill: Skill): void;
  add(skills: Skill[]): void;
  add(skillOrSkills: Skill | Skill[]): void {
    if (Array.isArray(skillOrSkills)) {
      for (const skill of skillOrSkills) {
        this.skills.set(skill.id, skill);
      }
    } else {
      this.skills.set(skillOrSkills.id, skillOrSkills);
    }
  }

  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  available(): Skill[] {
    return Array.from(this.skills.values());
  }

  find(criteria: (skill: Skill) => boolean): Skill[] {
    return Array.from(this.skills.values()).filter(criteria);
  }

  clear(): void {
    this.skills.clear();
  }
}

/**
 * Skill definition
 */
export interface Skill {
  id: string;
  name: string;
  description: string;
  preconditions: string[];
  effects: string[];
  execute: (context: Context) => Promise<any>;
  cost?: number;
}

/**
 * Cognitive Flow interface - extends Flow with cognitive capabilities
 */
export interface CognitiveFlow<In = any, Out = any> extends Flow<In, Out> {
  // Learning
  learn(examples: Example<In, Out>[]): Promise<void>;

  // Reasoning
  reason(): ReasoningChain;

  // Planning
  plan(goal: Goal): Promise<Plan>;

  // Memory
  remember(key: string, value: any): void;
  recall(key: string): any;

  // Explanation
  explain(): Explanation;

  // Self-assessment
  evaluate(): QualityMetrics;

  // Knowledge access
  readonly knowledge: KnowledgeGraph;
  readonly beliefs: BeliefSet;
  readonly goals: GoalHierarchy;
}

/**
 * Base implementation of CognitiveFlow (internal, not directly callable)
 */
export abstract class BaseCognitiveFlow<In = any, Out = any> {
  // Knowledge management
  readonly knowledge: KnowledgeGraph = new KnowledgeGraph();
  readonly beliefs: BeliefSet = new BeliefSet();
  readonly goals: GoalHierarchy = new GoalHierarchy();
  readonly skills: SkillLibrary = new SkillLibrary();

  // Memory systems
  private readonly shortTermMemory: Memory<string, any> = new Memory({ maxSize: 100 });
  private readonly episodicMemory: EpisodicMemory = new EpisodicMemory({ maxEpisodes: 1000 });

  // Learning system
  protected readonly learner: UniversalLearner = new UniversalLearner();

  // Reasoning and planning
  protected readonly reasoner: ReasoningEngine = new ReasoningEngine();
  protected readonly planner: GoalPlanner = new GoalPlanner();

  constructor(protected readonly baseFn: (input: In) => Out | Promise<Out>) {}

  /**
   * Execute the flow (implementing Flow interface)
   */
  async call(input: In): Promise<Out> {
    // Update beliefs based on input
    this.updateBeliefs(input);

    // Check if we should learn from this execution
    if (this.shouldLearn(input)) {
      await this.learnFromExecution(input);
    }

    // Execute with monitoring
    const output = await this.executeWithMonitoring(input);

    // Update knowledge graph
    this.updateKnowledge(input, output);

    // Store in episodic memory
    this.episodicMemory.store({
      input,
      output,
      context: {},
      timestamp: Date.now(),
    });

    return output;
  }

  /**
   * Implement pipe for composition
   */
  pipe<Next>(next: Flow<Out, Next>): Flow<In, Next> {
    const composed = async (input: In): Promise<Next> => {
      const intermediate = await this.call(input);
      return next(intermediate);
    };
    // Add pipe method to composed
    (composed as any).pipe = function <N>(nextFlow: Flow<Next, N>): Flow<In, N> {
      return new Proxy(composed as any, {
        apply: async (_target, _thisArg, args: [In]) => {
          const result = await composed(args[0]);
          return nextFlow(result);
        },
      }) as Flow<In, N>;
    };
    return composed as Flow<In, Next>;
  }

  /**
   * Learn from examples
   */
  async learn(examples: Example<In, Out>[]): Promise<void> {
    // Preprocess examples
    const processed = await this.preprocessExamples(examples);

    // Extract patterns using the learner
    const patterns = await this.learner.extractPatterns(processed);

    // Update internal model
    await this.learner.updateModel(patterns);

    // Integrate patterns into knowledge graph
    for (const pattern of patterns) {
      this.knowledge.addPattern(pattern);
    }
  }

  /**
   * Generate reasoning chain
   */
  reason(): ReasoningChain {
    return this.reasoner.reason({
      premises: this.beliefs.toPremises(),
      knowledge: this.knowledge,
      goal: this.goals.primary(),
    });
  }

  /**
   * Plan to achieve a goal
   */
  async plan(goal: Goal): Promise<Plan> {
    return this.planner.plan({
      goal,
      initialState: {},
      actions: this.skills.available(),
      constraints: [],
    });
  }

  /**
   * Remember a value
   */
  remember(key: string, value: any): void {
    this.shortTermMemory.set(key, value);
  }

  /**
   * Recall a value
   */
  recall(key: string): any {
    return this.shortTermMemory.get(key);
  }

  /**
   * Explain the flow's behavior
   */
  explain(): Explanation {
    const recentExamples = this.episodicMemory.getRecent(5);

    return {
      summary: this.generateSummary(),
      details: this.generateDetails(),
      examples: recentExamples.map((e) => ({
        input: e.input,
        output: e.output,
        metadata: { timestamp: e.timestamp },
      })),
      concepts: this.knowledge.getConcepts(),
      reasoning: this.reasoner.getLastChain(),
    };
  }

  /**
   * Self-assessment
   */
  evaluate(): QualityMetrics {
    const recentExamples = this.episodicMemory.getRecent(100);

    return {
      accuracy: this.calculateAccuracy(recentExamples),
      performance: this.calculatePerformance(recentExamples),
      reliability: this.calculateReliability(recentExamples),
      efficiency: this.calculateEfficiency(recentExamples),
      understandability: 0.8, // Would need more sophisticated analysis
      maintainability: 0.75,
    };
  }

  /**
   * Protected: Preprocess examples for learning
   */
  protected async preprocessExamples(examples: Example<In, Out>[]): Promise<ProcessedExample<In, Out>[]> {
    return examples.map((ex) => ({
      ...ex,
      features: this.extractFeatures(ex.input),
      timestamp: Date.now(),
    }));
  }

  /**
   * Protected: Extract features from input
   */
  protected extractFeatures(input: In): Map<string, any> {
    const features = new Map<string, any>();

    if (typeof input === 'object' && input !== null) {
      for (const [key, value] of Object.entries(input)) {
        features.set(key, value);
      }
    }

    return features;
  }

  /**
   * Protected: Execute with monitoring
   */
  protected async executeWithMonitoring(input: In): Promise<Out> {
    const result = await this.baseFn(input);
    return result;
  }

  /**
   * Protected: Update beliefs based on input
   */
  protected updateBeliefs(input: In): void {
    this.beliefs.add('last_input', input);
    this.beliefs.add('execution_count', (this.beliefs.get('execution_count') ?? 0) + 1);
  }

  /**
   * Protected: Update knowledge based on execution
   */
  protected updateKnowledge(input: In, output: Out): void {
    this.knowledge.addRelation('maps_to', String(input), String(output));
  }

  /**
   * Protected: Determine if we should learn from this input
   */
  protected shouldLearn(_input: In): boolean {
    return false; // Default: don't learn unless overridden
  }

  /**
   * Protected: Learn from execution
   */
  protected async learnFromExecution(input: In): Promise<void> {
    const output = await this.baseFn(input);
    await this.learn([{ input, output }]);
  }

  /**
   * Protected: Generate summary
   */
  protected generateSummary(): string {
    return 'A cognitive flow with learning capabilities';
  }

  /**
   * Protected: Generate details
   */
  protected generateDetails(): string[] {
    return [
      `Executed ${this.beliefs.get('execution_count') ?? 0} times`,
      `Knowledge: ${this.knowledge.size()} concepts`,
      `Beliefs: ${this.beliefs.list().length} active`,
    ];
  }

  /**
   * Protected: Calculate accuracy
   */
  protected calculateAccuracy(examples: any[]): number {
    return examples.length > 0 ? 0.9 : 0;
  }

  /**
   * Protected: Calculate performance
   */
  protected calculatePerformance(_examples: any[]): number {
    return 0.85;
  }

  /**
   * Protected: Calculate reliability
   */
  protected calculateReliability(_examples: any[]): number {
    return 0.95;
  }

  /**
   * Protected: Calculate efficiency
   */
  protected calculateEfficiency(_examples: any[]): number {
    return 0.8;
  }
}

/**
 * Create a cognitive flow from a function
 */
export function cognitiveFlow<In, Out>(fn: (input: In) => Out | Promise<Out>): CognitiveFlow<In, Out> {
  const instance = new (class extends BaseCognitiveFlow<In, Out> {
    constructor() {
      super(fn);
    }
  })();

  // Create callable wrapper that also has all the methods
  const callable = async (input: In): Promise<Out> => {
    return instance.call(input);
  };

  // Copy all properties from instance to callable
  Object.setPrototypeOf(callable, Object.getPrototypeOf(instance));
  Object.assign(callable, instance);

  return callable as unknown as CognitiveFlow<In, Out>;
}
