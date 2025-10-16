/**
 * Cognitive feature types
 * Types for advanced cognitive capabilities
 */

/**
 * Optimization options
 */
export interface OptimizationOptions {
  goals: OptimizationGoal[];
  constraints?: Constraint[];
  algorithm?: 'genetic' | 'gradient-descent' | 'simulated-annealing';
  iterations?: number;
  populationSize?: number;
  mutationRate?: number;
  crossoverRate?: number;
}

/**
 * Optimization goal
 */
export interface OptimizationGoal {
  metric: string;
  weight: number;
  target: 'maximize' | 'minimize';
  evaluator?: (value: any) => number;
}

/**
 * Constraint for optimization
 */
export interface Constraint {
  key: string;
  type: 'min' | 'max' | 'equals' | 'range';
  value: number | [number, number];
}

/**
 * Change made during optimization
 */
export interface OptimizationChange {
  key: string;
  oldValue: any;
  newValue: any;
  improvement: number;
}

/**
 * Optimization result
 */
export interface OptimizationResult {
  improved: boolean;
  changes: OptimizationChange[];
  score: number;
  iterations: number;
  algorithm: string;
}

/**
 * Causality analysis options
 */
export interface CausalityOptions {
  timeWindow?: string;
  correlationThreshold?: number;
  includeIndirect?: boolean;
}

/**
 * Causal factor
 */
export interface CausalFactor {
  key: string;
  correlation: number;
  strength: 'weak' | 'moderate' | 'strong';
  type: 'direct' | 'indirect';
  evidence: string[];
}

/**
 * Causality analysis result
 */
export interface CausalityResult {
  key: string;
  causes: CausalFactor[];
  effects: CausalFactor[];
  timestamp: number;
}

/**
 * Explanation options
 */
export interface ExplainOptions {
  depth?: 'brief' | 'detailed';
  includeHistory?: boolean;
  includeImpact?: boolean;
  includeCausality?: boolean;
}

/**
 * Explanation result
 */
export interface Explanation {
  key: string;
  value: any;
  text: string;
  reasons: string[];
  impact?: string[];
  history?: HistoryEntry[];
  causality?: CausalityResult;
}

/**
 * History entry
 */
export interface HistoryEntry {
  timestamp: number;
  value: any;
  operation: string;
}
