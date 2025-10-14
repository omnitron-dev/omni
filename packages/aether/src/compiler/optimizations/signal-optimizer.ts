/**
 * Signal Optimization Pass
 * Optimizes signal usage patterns for better performance
 */

import type {
  OptimizationChange,
  OptimizationContext,
  OptimizationPass,
  OptimizationResult,
  OptimizerOptions,
} from '../optimizer.js';

/**
 * Signal optimization options
 */
export interface SignalOptimizerOptions {
  /**
   * Inline constant signals
   * @default true
   */
  inlineConstants?: boolean;

  /**
   * Remove unused signal subscriptions
   * @default true
   */
  removeUnusedSubscriptions?: boolean;

  /**
   * Optimize signal access patterns
   * @default true
   */
  optimizeAccessPatterns?: boolean;

  /**
   * Merge sequential signal updates
   * @default true
   */
  mergeSequentialUpdates?: boolean;

  /**
   * Convert single-use signals to direct values
   * @default false (aggressive only)
   */
  convertSingleUseSignals?: boolean;
}

/**
 * Signal usage analysis
 */
interface SignalUsage {
  name: string;
  isConstant: boolean;
  constantValue?: unknown;
  accessCount: number;
  updateCount: number;
  subscriptionCount: number;
  firstAccess: number;
  lastAccess: number;
}

/**
 * Signal optimizer pass
 */
export class SignalOptimizer implements OptimizationPass {
  name = 'signal-optimizer';
  priority = 100; // Run early

  private options: Required<SignalOptimizerOptions>;
  private aggressive: boolean;

  constructor(optimizerOptions: Required<OptimizerOptions>) {
    this.aggressive = optimizerOptions.mode === 'aggressive';

    this.options = {
      inlineConstants: true,
      removeUnusedSubscriptions: true,
      optimizeAccessPatterns: true,
      mergeSequentialUpdates: true,
      convertSingleUseSignals: this.aggressive,
    };
  }

  /**
   * Transform code
   */
  async transform(code: string, context: OptimizationContext): Promise<OptimizationResult> {
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    let optimizedCode = code;

    // Analyze signal usage
    const signalUsage = this.analyzeSignalUsage(optimizedCode);

    // Pass 0: Optimize access patterns (analyze first, before modifications)
    if (this.options.optimizeAccessPatterns) {
      const result = this.optimizeAccessPatterns(optimizedCode, signalUsage);
      optimizedCode = result.code;
      changes.push(...result.changes);
      warnings.push(...result.warnings);
    }

    // Pass 1: Convert single-use signals (aggressive only) - must run before inline
    if (this.options.convertSingleUseSignals) {
      const result = this.convertSingleUseSignals(optimizedCode, signalUsage);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Pass 2: Inline constant signals (for multi-use constants)
    if (this.options.inlineConstants) {
      const result = this.inlineConstantSignals(optimizedCode, signalUsage);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Pass 3: Remove unused subscriptions
    if (this.options.removeUnusedSubscriptions) {
      const result = this.removeUnusedSubscriptions(optimizedCode, signalUsage);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    // Pass 4: Merge sequential updates
    if (this.options.mergeSequentialUpdates) {
      const result = this.mergeSequentialUpdates(optimizedCode);
      optimizedCode = result.code;
      changes.push(...result.changes);
    }

    return {
      code: optimizedCode,
      changes,
      warnings,
      metadata: {
        signalsAnalyzed: signalUsage.size,
        constantSignals: Array.from(signalUsage.values()).filter((s) => s.isConstant).length,
      },
    };
  }

  /**
   * Analyze signal usage patterns
   */
  private analyzeSignalUsage(code: string): Map<string, SignalUsage> {
    const usage = new Map<string, SignalUsage>();
    const lines = code.split('\n');

    // Pattern: const [count, setCount] = signal(initialValue)
    const signalDeclarationRegex = /const\s+\[(\w+),\s*(\w+)\]\s*=\s*signal\(([^)]+)\)/g;
    // Pattern: const count = signal(initialValue)
    const simpleSignalRegex = /const\s+(\w+)\s*=\s*signal\(([^)]+)\)/g;

    lines.forEach((line, index) => {
      // Find signal declarations
      let match: RegExpExecArray | null;

      while ((match = signalDeclarationRegex.exec(line)) !== null) {
        const signalName = match[1];
        const initialValue = match[3];

        if (signalName) {
          usage.set(signalName, {
            name: signalName,
            isConstant: this.isConstantValue(initialValue || ''),
            constantValue: this.parseConstantValue(initialValue || ''),
            accessCount: 0,
            updateCount: 0,
            subscriptionCount: 0,
            firstAccess: -1,
            lastAccess: -1,
          });
        }
      }

      while ((match = simpleSignalRegex.exec(line)) !== null) {
        const signalName = match[1];
        const initialValue = match[2];

        if (signalName) {
          usage.set(signalName, {
            name: signalName,
            isConstant: this.isConstantValue(initialValue || ''),
            constantValue: this.parseConstantValue(initialValue || ''),
            accessCount: 0,
            updateCount: 0,
            subscriptionCount: 0,
            firstAccess: -1,
            lastAccess: -1,
          });
        }
      }
    });

    // Count signal accesses and updates
    lines.forEach((line, index) => {
      for (const [signalName, info] of usage) {
        // Count reads: signal()
        const readPattern = new RegExp(`\\b${signalName}\\(\\)`, 'g');
        const reads = (line.match(readPattern) || []).length;
        if (reads > 0) {
          info.accessCount += reads;
          if (info.firstAccess === -1) {
            info.firstAccess = index;
          }
          info.lastAccess = index;
        }

        // Count writes: setSignal(value)
        const setterName = `set${signalName.charAt(0).toUpperCase()}${signalName.slice(1)}`;
        const writePattern = new RegExp(`\\b${setterName}\\(`, 'g');
        const writes = (line.match(writePattern) || []).length;
        if (writes > 0) {
          info.updateCount += writes;
        }

        // Count subscriptions in effects
        if (line.includes('effect(') && line.includes(signalName)) {
          info.subscriptionCount++;
        }
      }
    });

    return usage;
  }

  /**
   * Check if value is a constant
   */
  private isConstantValue(value: string): boolean {
    const trimmed = value.trim();

    // Literals
    if (/^(?:true|false|null|undefined|\d+|'[^']*'|"[^"]*"|`[^`]*`)$/.test(trimmed)) {
      return true;
    }

    // Simple objects/arrays
    if (/^(?:\{[^}]*\}|\[[^\]]*\])$/.test(trimmed)) {
      return true;
    }

    return false;
  }

  /**
   * Parse constant value
   */
  private parseConstantValue(value: string): unknown {
    const trimmed = value.trim();

    try {
      // Handle special cases
      if (trimmed === 'true') return true;
      if (trimmed === 'false') return false;
      if (trimmed === 'null') return null;
      if (trimmed === 'undefined') return undefined;

      // Try parsing as JSON
      return JSON.parse(trimmed);
    } catch {
      // Return as string if parsing fails
      return trimmed;
    }
  }

  /**
   * Inline constant signals
   */
  private inlineConstantSignals(
    code: string,
    usage: Map<string, SignalUsage>
  ): { code: string; changes: OptimizationChange[] } {
    let optimizedCode = code;
    const changes: OptimizationChange[] = [];

    for (const [signalName, info] of usage) {
      // Only inline if:
      // 1. Signal is constant
      // 2. Never updated (updateCount === 0)
      // 3. Accessed exactly once (single-use only for inlining)
      if (info.isConstant && info.updateCount === 0 && info.accessCount === 1) {
        const constantValue =
          typeof info.constantValue === 'string' ? info.constantValue : JSON.stringify(info.constantValue);

        // Replace signal() calls with constant value
        const accessPattern = new RegExp(`\\b${signalName}\\(\\)`, 'g');
        const beforeLength = optimizedCode.length;
        optimizedCode = optimizedCode.replace(accessPattern, constantValue);
        const afterLength = optimizedCode.length;

        if (beforeLength !== afterLength) {
          changes.push({
            type: 'signal-inline',
            description: `Inlined constant signal '${signalName}' with value ${constantValue}`,
            sizeImpact: beforeLength - afterLength,
          });

          // Remove signal declaration after inlining single-use signal
          const declarationPattern = new RegExp(
            `const\\s+(?:\\[${signalName},\\s*\\w+\\]|${signalName})\\s*=\\s*signal\\([^)]+\\);?\\s*\n?`,
            'g'
          );
          optimizedCode = optimizedCode.replace(declarationPattern, '');
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Remove unused signal subscriptions
   */
  private removeUnusedSubscriptions(
    code: string,
    usage: Map<string, SignalUsage>
  ): { code: string; changes: OptimizationChange[] } {
    let optimizedCode = code;
    const changes: OptimizationChange[] = [];

    // Find signals that are never accessed AND never updated
    for (const [signalName, info] of usage) {
      if (info.accessCount === 0 && info.subscriptionCount === 0 && info.updateCount === 0) {
        // Remove signal declaration
        const declarationPattern = new RegExp(
          `const\\s+(?:\\[${signalName},\\s*\\w+\\]|${signalName})\\s*=\\s*signal\\([^)]+\\);?\\s*\n?`,
          'g'
        );

        const beforeLength = optimizedCode.length;
        optimizedCode = optimizedCode.replace(declarationPattern, '');
        const afterLength = optimizedCode.length;

        if (beforeLength !== afterLength) {
          changes.push({
            type: 'signal-inline',
            description: `Removed unused signal '${signalName}'`,
            sizeImpact: beforeLength - afterLength,
          });
        }
      }
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Optimize signal access patterns
   */
  private optimizeAccessPatterns(
    code: string,
    usage: Map<string, SignalUsage>
  ): { code: string; changes: OptimizationChange[]; warnings: string[] } {
    const optimizedCode = code;
    const changes: OptimizationChange[] = [];
    const warnings: string[] = [];

    // Pattern: Multiple accesses in same expression
    // Example: signal() + signal() → (const val = signal(), val + val)
    for (const [signalName, info] of usage) {
      if (info.accessCount > 1) {
        // Check for multiple accesses in single line
        const lines = optimizedCode.split('\n');
        lines.forEach((line, index) => {
          const accessPattern = new RegExp(`\\b${signalName}\\(\\)`, 'g');
          const matches = line.match(accessPattern);

          if (matches && matches.length >= 2) {
            warnings.push(
              `Signal '${signalName}' accessed ${matches.length} times on line ${index + 1}. Consider caching the value.`
            );
          }
        });
      }
    }

    return { code: optimizedCode, changes, warnings };
  }

  /**
   * Merge sequential signal updates
   */
  private mergeSequentialUpdates(code: string): {
    code: string;
    changes: OptimizationChange[];
  } {
    let optimizedCode = code;
    const changes: OptimizationChange[] = [];

    // Pattern: setCount(x); setCount(y); → setCount(y);
    // Look for sequential updates to same signal
    const lines = optimizedCode.split('\n');
    const mergedLines: string[] = [];
    const updates = new Map<string, { value: string; line: number }>();

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] || '';
      const setPattern = /(\w+)\(([^)]+)\);?/;
      const match = setPattern.exec(line.trim());

      if (match && match[1]?.startsWith('set')) {
        const setterName = match[1];
        const value = match[2];

        if (setterName && value) {
          const previous = updates.get(setterName);

          if (previous && i - previous.line === 1) {
            // Sequential update found
            updates.set(setterName, { value, line: i });
            changes.push({
              type: 'signal-inline',
              description: `Merged sequential updates to ${setterName}`,
              location: { line: i + 1, column: 0 },
            });
            // Skip the previous line (it's redundant)
            continue;
          } else {
            updates.set(setterName, { value, line: i });
          }
        }
      }

      mergedLines.push(line);
    }

    if (changes.length > 0) {
      optimizedCode = mergedLines.join('\n');
    }

    return { code: optimizedCode, changes };
  }

  /**
   * Convert single-use signals to direct values
   */
  private convertSingleUseSignals(
    code: string,
    usage: Map<string, SignalUsage>
  ): { code: string; changes: OptimizationChange[] } {
    let optimizedCode = code;
    const changes: OptimizationChange[] = [];

    for (const [signalName, info] of usage) {
      // Convert if:
      // 1. Accessed only once
      // 2. Never updated
      // 3. No subscriptions
      // 4. Is a constant value
      if (
        info.accessCount === 1 &&
        info.updateCount === 0 &&
        info.subscriptionCount === 0 &&
        info.isConstant
      ) {
        // Replace signal with direct value
        const accessPattern = new RegExp(`\\b${signalName}\\(\\)`, 'g');
        const value = typeof info.constantValue === 'string' ? info.constantValue : JSON.stringify(info.constantValue);

        const beforeLength = optimizedCode.length;
        optimizedCode = optimizedCode.replace(accessPattern, value);

        // Remove declaration
        const declarationPattern = new RegExp(
          `const\\s+(?:\\[${signalName},\\s*\\w+\\]|${signalName})\\s*=\\s*signal\\([^)]+\\);?\\s*\n?`,
          'g'
        );
        optimizedCode = optimizedCode.replace(declarationPattern, '');
        const afterLength = optimizedCode.length;

        if (beforeLength !== afterLength) {
          changes.push({
            type: 'signal-inline',
            description: `Converted single-use signal '${signalName}' to direct value`,
            sizeImpact: beforeLength - afterLength,
          });
        }
      }
    }

    return { code: optimizedCode, changes };
  }
}
