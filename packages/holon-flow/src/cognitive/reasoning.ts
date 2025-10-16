/**
 * Reasoning Engine - Logical deduction and inference
 */

import type { KnowledgeGraph } from './knowledge.js';
import type { Goal } from './planning.js';

/**
 * Reasoning step
 */
export interface ReasoningStep {
  type: 'premise' | 'inference' | 'conclusion';
  content: string;
  confidence: number;
  justification?: string;
}

/**
 * Reasoning chain
 */
export interface ReasoningChain {
  steps: ReasoningStep[];
  conclusion: string;
  confidence: number;
  assumptions: string[];
  alternatives: string[];
}

/**
 * Reasoning context
 */
export interface ReasoningContext {
  premises: string[];
  knowledge: KnowledgeGraph;
  goal?: Goal;
  constraints?: string[];
}

/**
 * Inference rule
 */
interface InferenceRule {
  name: string;
  pattern: (premises: string[]) => boolean;
  apply: (premises: string[]) => string;
  confidence: number;
}

/**
 * Reasoning engine for logical deduction
 */
export class ReasoningEngine {
  private rules: InferenceRule[] = [];
  private lastChain: ReasoningChain | null = null;

  constructor() {
    this.initializeRules();
  }

  /**
   * Perform reasoning
   */
  reason(context: ReasoningContext): ReasoningChain {
    const steps: ReasoningStep[] = [];
    const assumptions: string[] = [];

    // Add premises as initial steps
    for (const premise of context.premises) {
      steps.push({
        type: 'premise',
        content: premise,
        confidence: 1.0,
      });
    }

    // Apply inference rules iteratively
    const derived = new Set<string>(context.premises);
    let changed = true;
    let iterations = 0;
    const maxIterations = 10;

    while (changed && iterations < maxIterations) {
      changed = false;
      iterations++;

      for (const rule of this.rules) {
        const premises = Array.from(derived);
        if (rule.pattern(premises)) {
          const inference = rule.apply(premises);

          if (!derived.has(inference)) {
            derived.add(inference);
            steps.push({
              type: 'inference',
              content: inference,
              confidence: rule.confidence,
              justification: `Applied rule: ${rule.name}`,
            });
            changed = true;
          }
        }
      }
    }

    // Generate conclusion
    const conclusion = this.generateConclusion(steps, context);

    // Calculate overall confidence
    const confidence = this.calculateConfidence(steps);

    // Find alternative conclusions
    const alternatives = this.findAlternatives(steps, context);

    const chain: ReasoningChain = {
      steps,
      conclusion,
      confidence,
      assumptions,
      alternatives,
    };

    this.lastChain = chain;
    return chain;
  }

  /**
   * Get last reasoning chain
   */
  getLastChain(): ReasoningChain {
    return this.lastChain || {
      steps: [],
      conclusion: 'No reasoning performed yet',
      confidence: 0,
      assumptions: [],
      alternatives: [],
    };
  }

  /**
   * Add custom inference rule
   */
  addRule(rule: InferenceRule): void {
    this.rules.push(rule);
  }

  /**
   * Private: Initialize basic inference rules
   */
  private initializeRules(): void {
    // Modus Ponens: If P and P->Q, then Q
    this.rules.push({
      name: 'modus-ponens',
      pattern: (premises) => {
        for (let i = 0; i < premises.length; i++) {
          for (let j = 0; j < premises.length; j++) {
            if (i !== j) {
              const p = premises[i];
              const impl = premises[j];
              if (impl?.includes('->') && impl.startsWith(p + '->')) {
                return true;
              }
            }
          }
        }
        return false;
      },
      apply: (premises) => {
        for (let i = 0; i < premises.length; i++) {
          for (let j = 0; j < premises.length; j++) {
            if (i !== j) {
              const p = premises[i];
              const impl = premises[j];
              if (impl?.includes('->') && impl.startsWith(p + '->')) {
                return impl.split('->')[1]!.trim();
              }
            }
          }
        }
        return '';
      },
      confidence: 0.95,
    });

    // Modus Tollens: If P->Q and not Q, then not P
    this.rules.push({
      name: 'modus-tollens',
      pattern: (premises) => {
        return premises.some((p) => p.includes('->')) && premises.some((p) => p.startsWith('not '));
      },
      apply: (premises) => {
        const implications = premises.filter((p) => p.includes('->'));
        const negations = premises.filter((p) => p.startsWith('not '));

        for (const impl of implications) {
          const [antecedent, consequent] = impl.split('->').map((s) => s.trim());
          for (const neg of negations) {
            if (neg === `not ${consequent}`) {
              return `not ${antecedent}`;
            }
          }
        }

        return '';
      },
      confidence: 0.95,
    });

    // Conjunction: If P and Q, then P AND Q
    this.rules.push({
      name: 'conjunction',
      pattern: (premises) => premises.length >= 2,
      apply: (premises) => {
        if (premises.length >= 2) {
          return `${premises[0]} AND ${premises[1]}`;
        }
        return '';
      },
      confidence: 1.0,
    });

    // Simplification: If P AND Q, then P (and also Q)
    this.rules.push({
      name: 'simplification',
      pattern: (premises) => premises.some((p) => p.includes(' AND ')),
      apply: (premises) => {
        const conjunction = premises.find((p) => p.includes(' AND '));
        if (conjunction) {
          return conjunction.split(' AND ')[0]!.trim();
        }
        return '';
      },
      confidence: 1.0,
    });
  }

  /**
   * Private: Generate conclusion from steps
   */
  private generateConclusion(steps: ReasoningStep[], context: ReasoningContext): string {
    // If there's a goal, check if we reached it
    if (context.goal) {
      const goalStatement = context.goal.description || context.goal.name;
      const reached = steps.some((step) => step.content.includes(goalStatement));

      if (reached) {
        return `Goal "${goalStatement}" is achievable`;
      } else {
        return `Goal "${goalStatement}" cannot be conclusively reached`;
      }
    }

    // Otherwise, use the last high-confidence inference
    const inferences = steps.filter((s) => s.type === 'inference' && s.confidence > 0.8);

    if (inferences.length > 0) {
      return inferences[inferences.length - 1]!.content;
    }

    // Fallback
    if (steps.length > 0) {
      return steps[steps.length - 1]!.content;
    }

    return 'No conclusion could be drawn';
  }

  /**
   * Private: Calculate overall confidence
   */
  private calculateConfidence(steps: ReasoningStep[]): number {
    if (steps.length === 0) return 0;

    // Use minimum confidence (chain is as strong as its weakest link)
    const confidences = steps.filter((s) => s.type === 'inference').map((s) => s.confidence);

    if (confidences.length === 0) return 1.0;

    return Math.min(...confidences);
  }

  /**
   * Private: Find alternative conclusions
   */
  private findAlternatives(steps: ReasoningStep[], _context: ReasoningContext): string[] {
    const alternatives: string[] = [];

    // Find other possible inferences
    const inferences = steps.filter((s) => s.type === 'inference');

    for (const inference of inferences) {
      if (inference.confidence > 0.5 && inference.confidence < 0.9) {
        alternatives.push(inference.content);
      }
    }

    return alternatives.slice(0, 3); // Limit to 3 alternatives
  }
}

/**
 * Deductive reasoning
 */
export function deductiveReasoning(premises: string[], rules: InferenceRule[]): string[] {
  const conclusions: string[] = [];
  const derived = new Set<string>(premises);

  for (const rule of rules) {
    if (rule.pattern(premises)) {
      const conclusion = rule.apply(premises);
      if (conclusion && !derived.has(conclusion)) {
        derived.add(conclusion);
        conclusions.push(conclusion);
      }
    }
  }

  return conclusions;
}

/**
 * Abductive reasoning (inference to best explanation)
 */
export function abductiveReasoning(
  observations: string[],
  hypotheses: Array<{ hypothesis: string; explains: string[]; probability: number }>,
): string {
  // Find hypothesis that best explains observations
  let bestHypothesis = '';
  let bestScore = -Infinity;

  for (const h of hypotheses) {
    // Count how many observations are explained
    const explained = observations.filter((obs) => h.explains.includes(obs)).length;

    // Score = explained observations * probability
    const score = explained * h.probability;

    if (score > bestScore) {
      bestScore = score;
      bestHypothesis = h.hypothesis;
    }
  }

  return bestHypothesis;
}

/**
 * Analogical reasoning
 */
export function analogicalReasoning(
  source: { domain: string; properties: string[] },
  target: { domain: string; properties: string[] },
): string[] {
  const inferences: string[] = [];

  // Find common properties
  const common = source.properties.filter((p) => target.properties.includes(p));

  // Infer that other source properties might apply to target
  const unique = source.properties.filter((p) => !target.properties.includes(p));

  for (const prop of unique) {
    if (common.length > 0) {
      // If there are common properties, infer by analogy
      inferences.push(`${target.domain} might have property: ${prop} (by analogy with ${source.domain})`);
    }
  }

  return inferences;
}
