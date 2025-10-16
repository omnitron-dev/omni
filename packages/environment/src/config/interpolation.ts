/**
 * Variable interpolation context
 */
export interface InterpolationContext {
  variables: Record<string, any>;
  env?: Record<string, string>;
}

/**
 * Interpolate variables in a string
 */
export function interpolate(template: string, context: InterpolationContext): string {
  // Replace ${variable} patterns
  return template.replace(/\$\{([^}]+)\}/g, (match, expression) => {
    expression = expression.trim();

    // Handle environment variables: ${env.VAR_NAME}
    if (expression.startsWith('env.')) {
      const envVar = expression.substring(4);
      return context.env?.[envVar] ?? match;
    }

    // Handle regular variables
    if (expression in context.variables) {
      const value = context.variables[expression];
      return String(value);
    }

    // Return original if not found
    return match;
  });
}

/**
 * Interpolate variables in an object recursively
 */
export function interpolateObject(obj: any, context: InterpolationContext): any {
  if (typeof obj === 'string') {
    return interpolate(obj, context);
  }

  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateObject(item, context));
  }

  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateObject(value, context);
    }
    return result;
  }

  return obj;
}

/**
 * Check if a string contains variables
 */
export function hasVariables(str: string): boolean {
  return /\$\{[^}]+\}/.test(str);
}

/**
 * Extract variable names from a string
 */
export function extractVariables(str: string): string[] {
  const matches = str.matchAll(/\$\{([^}]+)\}/g);
  const variables: string[] = [];

  for (const match of matches) {
    const expression = match[1].trim();
    if (!expression.startsWith('env.')) {
      variables.push(expression);
    }
  }

  return variables;
}
