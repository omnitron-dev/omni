import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

export interface InterpolationContext {
  variables: Record<string, any>;
  env: Record<string, string | undefined>;
  secrets?: (key: string) => Promise<string | null>;
}

/**
 * Advanced interpolation engine
 * Supports:
 * - ${variable} - Simple variables
 * - ${env.VAR} - Environment variables
 * - ${secret:path} - Secrets
 * - ${cmd:command} - Command execution
 * - ${expr} - Expression evaluation
 */
export class Interpolator {
  private context: InterpolationContext;

  constructor(context: InterpolationContext) {
    this.context = context;
  }

  /**
   * Interpolate a template string synchronously
   * Only works with variables and env, not secrets or commands
   */
  interpolate(template: string): string {
    if (typeof template !== 'string') {
      return template;
    }

    let result = template;

    // Replace ${variable} references
    result = this.interpolateVariables(result);

    // Replace ${env.VAR} references
    result = this.interpolateEnv(result);

    return result;
  }

  /**
   * Interpolate a template string asynchronously
   * Supports all interpolation types including secrets and commands
   */
  async interpolateAsync(template: string): Promise<string> {
    if (typeof template !== 'string') {
      return template;
    }

    let result = template;

    // Replace ${variable} references
    result = this.interpolateVariables(result);

    // Replace ${env.VAR} references
    result = this.interpolateEnv(result);

    // Replace ${secret:key} references
    result = await this.interpolateSecrets(result);

    // Replace ${cmd:command} references
    result = await this.interpolateCommands(result);

    // Replace ${expr} expressions
    result = this.interpolateExpressions(result);

    return result;
  }

  /**
   * Interpolate variable references
   */
  private interpolateVariables(template: string): string {
    const varPattern = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;

    return template.replace(varPattern, (match, varName) => {
      if (varName in this.context.variables) {
        const value = this.context.variables[varName];
        return String(value);
      }
      return match;
    });
  }

  /**
   * Interpolate environment variable references
   */
  private interpolateEnv(template: string): string {
    const envPattern = /\$\{env\.([A-Z_][A-Z0-9_]*)\}/g;

    return template.replace(envPattern, (match, envVar) => {
      const value = this.context.env[envVar];
      return value !== undefined ? value : match;
    });
  }

  /**
   * Interpolate secret references (async)
   */
  private async interpolateSecrets(template: string): Promise<string> {
    if (!this.context.secrets) {
      return template;
    }

    const secretPattern = /\$\{secret:([^}]+)\}/g;
    const matches = Array.from(template.matchAll(secretPattern));

    let result = template;
    for (const match of matches) {
      const key = match[1];
      const value = await this.context.secrets(key);

      if (value !== null) {
        result = result.replace(match[0], value);
      }
    }

    return result;
  }

  /**
   * Interpolate command execution (async)
   */
  private async interpolateCommands(template: string): Promise<string> {
    const cmdPattern = /\$\{cmd:([^}]+)\}/g;
    const matches = Array.from(template.matchAll(cmdPattern));

    let result = template;
    for (const match of matches) {
      const command = match[1];

      try {
        const { stdout } = await execAsync(command);
        const output = stdout.trim();
        result = result.replace(match[0], output);
      } catch (error: any) {
        console.error(`Command execution failed: ${command}`, error.message);
        // Keep the placeholder on error
      }
    }

    return result;
  }

  /**
   * Interpolate expressions
   */
  private interpolateExpressions(template: string): string {
    // Simple expression evaluation (supports ternary operator)
    const exprPattern = /\$\{([^}]+)\?([^:]+):([^}]+)\}/g;

    return template.replace(exprPattern, (match, condition, trueVal, falseVal) => {
      try {
        // Evaluate condition safely
        const conditionResult = this.evaluateCondition(condition.trim());
        return conditionResult ? trueVal.trim() : falseVal.trim();
      } catch (error) {
        console.error(`Expression evaluation failed: ${match}`, error);
        return match;
      }
    });
  }

  /**
   * Evaluate a simple condition
   */
  private evaluateCondition(condition: string): boolean {
    // Replace variables in condition
    let evalCondition = condition;

    // Replace variable references
    for (const [key, value] of Object.entries(this.context.variables)) {
      const regex = new RegExp(`\\b${key}\\b`, 'g');
      const replacement = typeof value === 'string' ? `"${value}"` : String(value);
      evalCondition = evalCondition.replace(regex, replacement);
    }

    // Replace env references
    const envPattern = /env\.([A-Z_][A-Z0-9_]*)/g;
    evalCondition = evalCondition.replace(envPattern, (_match, envVar) => {
      const value = this.context.env[envVar];
      return value !== undefined ? `"${value}"` : 'undefined';
    });

    // Simple evaluation (supports ==, ===, !=, !==, >, <, >=, <=)
    // This is a simplified implementation - in production, use a proper expression parser
    try {
      // eslint-disable-next-line no-new-func
      return Boolean(new Function(`return ${evalCondition}`)());
    } catch (error) {
      return false;
    }
  }
}

/**
 * Detect circular dependencies in variable references
 */
export function detectCircularDependencies(variables: Record<string, any>): { circular: boolean; cycles: string[][] } {
  const graph = new Map<string, Set<string>>();

  // Build dependency graph
  for (const [key, value] of Object.entries(variables)) {
    if (typeof value === 'string') {
      const deps = extractVariableDependencies(value);
      graph.set(key, new Set(deps));
    } else {
      graph.set(key, new Set());
    }
  }

  // Detect cycles using DFS
  const visited = new Set<string>();
  const recursionStack = new Set<string>();
  const cycles: string[][] = [];

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function dfs(node: string, path: string[]): boolean {
    visited.add(node);
    recursionStack.add(node);
    path.push(node);

    const deps = graph.get(node) || new Set();
    for (const dep of deps) {
      if (!visited.has(dep)) {
        if (dfs(dep, [...path])) {
          return true;
        }
      } else if (recursionStack.has(dep)) {
        // Found cycle
        const cycleStart = path.indexOf(dep);
        cycles.push([...path.slice(cycleStart), dep]);
        return true;
      }
    }

    recursionStack.delete(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (!visited.has(node)) {
      dfs(node, []);
    }
  }

  return {
    circular: cycles.length > 0,
    cycles,
  };
}

/**
 * Extract variable dependencies from a template string
 */
function extractVariableDependencies(template: string): string[] {
  const varPattern = /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g;
  const deps: string[] = [];

  const matches = Array.from(template.matchAll(varPattern));
  for (const match of matches) {
    deps.push(match[1]);
  }

  return deps;
}
