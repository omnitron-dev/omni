import { TaskConfig, TaskDefinition } from '../types/layers.js';

/**
 * Parse and validate task definition
 */
export function parseTaskDefinition(name: string, config: TaskConfig): TaskDefinition {
  // Validate config
  if (!config.command && !config.script && !config.steps) {
    throw new Error(
      `Task '${name}' must have either 'command', 'script', or 'steps' defined`
    );
  }

  if (config.steps && (config.command || config.script)) {
    throw new Error(
      `Task '${name}' cannot have both 'steps' and 'command'/'script'`
    );
  }

  // Validate dependencies
  if (config.dependsOn) {
    if (!Array.isArray(config.dependsOn)) {
      throw new Error(`Task '${name}' dependsOn must be an array`);
    }
  }

  // Validate steps
  if (config.steps) {
    for (const [index, step] of config.steps.entries()) {
      if (!step.name) {
        throw new Error(`Task '${name}' step ${index} must have a name`);
      }

      if (!step.command && !step.task) {
        throw new Error(
          `Task '${name}' step '${step.name}' must have either 'command' or 'task'`
        );
      }
    }
  }

  return {
    name,
    config
  };
}

/**
 * Extract dependencies from task config
 */
export function extractDependencies(config: TaskConfig): string[] {
  const deps: string[] = [];

  // Explicit dependencies
  if (config.dependsOn) {
    deps.push(...config.dependsOn);
  }

  // Implicit dependencies from steps
  if (config.steps) {
    for (const step of config.steps) {
      if (step.task) {
        deps.push(step.task);
      }
    }
  }

  // Remove duplicates
  return Array.from(new Set(deps));
}
