/**
 * Effect Batching Pass
 * Groups and batches effect updates to reduce re-renders
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Effect batching options
 */
export interface EffectBatcherOptions {
  /**
   * Group related effects
   * @default true
   */
  groupRelatedEffects?: boolean;

  /**
   * Merge sequential effects
   * @default true
   */
  mergeSequentialEffects?: boolean;

  /**
   * Batch by signal dependency
   * @default true
   */
  batchByDependency?: boolean;

  /**
   * Maximum effects per batch
   * @default 10
   */
  maxBatchSize?: number;

  /**
   * Delay effect execution (ms)
   * @default 0
   */
  delayExecution?: number;
}

/**
 * Effect analysis
 */
interface EffectInfo {
  id: number;
  code: string;
  lineNumber: number;
  dependencies: Set<string>;
  hasSideEffects: boolean;
  canBatch: boolean;
}

/**
 * Effect batch
 */
interface EffectBatch {
  effects: EffectInfo[];
  dependencies: Set<string>;
  priority: number;
}

/**
 * Effect batcher pass
 */
export class EffectBatcher implements OptimizationPass {
  name = 'effect-batcher';
  priority = 200; // Run after signal optimization

  private options: Required<EffectBatcherOptions>;

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    this.options = {
      groupRelatedEffects: true,
      mergeSequentialEffects: true,
      batchByDependency: true,
      maxBatchSize: 10,
      delayExecution: 0,
    };
  }

  /**
   * Transform code
   */
  async transform(
    code: string,
    context: OptimizationContext,
  ): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;

    // Analyze effects
    const effects = this.analyzeEffects(optimizedCode);

    if (effects.length === 0) {
      return { code: optimizedCode, changes, warnings };
    }

    // Group related effects
    if (this.options.groupRelatedEffects) {
      const batches = this.groupEffects(effects);

      if (batches.length > 0) {
        const result = this.applyBatching(optimizedCode, batches);
        optimizedCode = result.code;
        changes.push(...result.changes);
        warnings.push(...result.warnings);
      }
    }

    // Merge sequential effects
    if (this.options.mergeSequentialEffects) {
      const result = this.mergeSequentialEffects(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        effectsAnalyzed: effects.length,
        batchesCreated: changes.filter((c) => c.type === 'effect-batch').length,
      },
    };
  }

  /**
   * Analyze effects in code
   */
  private analyzeEffects(code: string): EffectInfo[] {
    const effects: EffectInfo[] = [];
    const lines = code.split('\n');

    // Pattern: effect(() => { ... })
    const effectPattern = /effect\s*\(\s*\(\)\s*=>\s*{/g;
    const createEffectPattern = /createEffect\s*\(\s*\(\)\s*=>\s*{/g;

    let effectId = 0;
    let currentEffect: { start: number; code: string } | null = null;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';

      // Check for effect start
      if (effectPattern.test(line) || createEffectPattern.test(line)) {
        currentEffect = { start: i, code: line };
        braceDepth = (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;
        continue;
      }

      // Collect effect body
      if (currentEffect) {
        currentEffect.code += '\n' + line;
        braceDepth += (line.match(/{/g) || []).length;
        braceDepth -= (line.match(/}/g) || []).length;

        // Effect complete
        if (braceDepth === 0) {
          const dependencies = this.extractDependencies(currentEffect.code);
          const hasSideEffects = this.hasSideEffects(currentEffect.code);

          effects.push({
            id: effectId++,
            code: currentEffect.code,
            lineNumber: currentEffect.start,
            dependencies,
            hasSideEffects,
            canBatch: !hasSideEffects || this.isSafeToBatch(currentEffect.code),
          });

          currentEffect = null;
        }
      }
    }

    return effects;
  }

  /**
   * Extract signal dependencies from effect code
   */
  private extractDependencies(code: string): Set<string> {
    const dependencies = new Set<string>();

    // Pattern: signalName()
    const signalAccessPattern = /\b(\w+)\(\)/g;

    let match: RegExpExecArray | null;
    while ((match = signalAccessPattern.exec(code)) !== null) {
      const signalName = match[1];

      // Filter out common functions that aren't signals
      if (
        signalName &&
        !['console', 'log', 'error', 'warn', 'document', 'window'].includes(
          signalName,
        )
      ) {
        dependencies.add(signalName);
      }
    }

    return dependencies;
  }

  /**
   * Check if effect has side effects
   */
  private hasSideEffects(code: string): boolean {
    const sideEffectPatterns = [
      /console\.\w+/,
      /fetch\(/,
      /XMLHttpRequest/,
      /localStorage\./,
      /sessionStorage\./,
      /document\./,
      /window\./,
      /addEventListener/,
      /removeEventListener/,
      /setTimeout/,
      /setInterval/,
      /clearTimeout/,
      /clearInterval/,
    ];

    return sideEffectPatterns.some((pattern) => pattern.test(code));
  }

  /**
   * Check if effect is safe to batch despite side effects
   */
  private isSafeToBatch(code: string): boolean {
    // DOM updates are generally safe to batch
    const safeSideEffects = [
      /\.textContent\s*=/,
      /\.innerHTML\s*=/,
      /\.className\s*=/,
      /\.style\./,
      /\.setAttribute\(/,
      /\.classList\./,
    ];

    return safeSideEffects.some((pattern) => pattern.test(code));
  }

  /**
   * Group effects into batches
   */
  private groupEffects(effects: EffectInfo[]): EffectBatch[] {
    const batches: EffectBatch[] = [];
    const processed = new Set<number>();

    for (const effect of effects) {
      if (processed.has(effect.id) || !effect.canBatch) {
        continue;
      }

      // Create new batch
      const batch: EffectBatch = {
        effects: [effect],
        dependencies: new Set(effect.dependencies),
        priority: effect.lineNumber,
      };

      processed.add(effect.id);

      // Find related effects
      for (const other of effects) {
        if (
          processed.has(other.id) ||
          !other.canBatch ||
          batch.effects.length >= this.options.maxBatchSize
        ) {
          continue;
        }

        // Check if effects share dependencies
        if (this.options.batchByDependency) {
          const hasSharedDependency = Array.from(other.dependencies).some((dep) =>
            batch.dependencies.has(dep),
          );

          if (hasSharedDependency) {
            batch.effects.push(other);
            for (const dep of other.dependencies) {
              batch.dependencies.add(dep);
            }
            processed.add(other.id);
          }
        }
      }

      // Only create batch if it has multiple effects
      if (batch.effects.length > 1) {
        batches.push(batch);
      }
    }

    return batches;
  }

  /**
   * Apply batching to code
   */
  private applyBatching(
    code: string,
    batches: EffectBatch[],
  ): {
    code: string;
    changes: OptimizationChange[];
    warnings: string[];
  } {
    let optimizedCode = code;
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    // Sort batches by priority (line number)
    batches.sort((a, b) => a.priority - b.priority);

    for (const batch of batches) {
      if (batch.effects.length < 2) continue;

      // Extract effect bodies
      const effectBodies = batch.effects.map((e) => {
        // Extract just the function body
        const match = /effect\s*\(\s*\(\)\s*=>\s*{([^}]+)}/s.exec(e.code);
        return match?.[1]?.trim() || '';
      });

      // Create batched effect
      const batchedEffect = this.createBatchedEffect(effectBodies, batch.dependencies);

      // Replace first effect with batched version
      const firstEffect = batch.effects[0];
      if (firstEffect) {
        optimizedCode = optimizedCode.replace(firstEffect.code, batchedEffect);

        // Remove other effects in batch
        for (let i = 1; i < batch.effects.length; i++) {
          const effect = batch.effects[i];
          if (effect) {
            optimizedCode = optimizedCode.replace(effect.code, '');
          }
        }

        changes.push({
          type: 'effect-batch',
          description: `Batched ${batch.effects.length} effects into single effect`,
          location: { line: firstEffect.lineNumber + 1, column: 0 },
        });
      }
    }

    return { code: optimizedCode, changes, warnings };
  }

  /**
   * Create batched effect code
   */
  private createBatchedEffect(
    bodies: string[],
    dependencies: Set<string>,
  ): string {
    const dependencyList = Array.from(dependencies).join(', ');
    const batchedBody = bodies.join('\n  ');

    if (this.options.delayExecution > 0) {
      return `effect(() => {
  batch(() => {
    ${batchedBody}
  }, ${this.options.delayExecution});
}, [${dependencyList}])`;
    }

    return `effect(() => {
  batch(() => {
    ${batchedBody}
  });
}, [${dependencyList}])`;
  }

  /**
   * Merge sequential effects
   */
  private mergeSequentialEffects(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    const changes: OptimizationChange[] = [];
    const lines = code.split('\n');
    const mergedLines: string[] = [];

    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (!line) {
        mergedLines.push(line || '');
        i++;
        continue;
      }

      // Check for consecutive effects
      if (
        line.includes('effect(') &&
        i + 1 < lines.length &&
        lines[i + 1]?.includes('effect(')
      ) {
        // Simple case: single-line effects
        if (line.includes('});') && lines[i + 1]?.includes('});')) {
          const effect1Body = this.extractSingleLineEffectBody(line);
          const effect2Body = this.extractSingleLineEffectBody(lines[i + 1] || '');

          if (effect1Body && effect2Body) {
            const merged = `effect(() => {
  ${effect1Body}
  ${effect2Body}
});`;

            mergedLines.push(merged);
            changes.push({
              type: 'effect-batch',
              description: 'Merged sequential single-line effects',
              location: { line: i + 1, column: 0 },
            });

            i += 2; // Skip both effects
            continue;
          }
        }
      }

      mergedLines.push(line);
      i++;
    }

    return {
      code: changes.length > 0 ? mergedLines.join('\n') : code,
      changes,
    };
  }

  /**
   * Extract body from single-line effect
   */
  private extractSingleLineEffectBody(line: string): string | null {
    const match = /effect\s*\(\s*\(\)\s*=>\s*{([^}]+)}\s*\);?/.exec(line);
    return match?.[1]?.trim() || null;
  }
}
