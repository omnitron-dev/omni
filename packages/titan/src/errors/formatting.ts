/**
 * Error message formatting utilities for improved developer experience
 * 
 * These helpers create actionable, context-rich error messages that help
 * developers quickly understand and fix issues.
 */

/**
 * Format a resolution chain for display
 */
export function formatResolutionChain(chain: string[]): string {
  if (chain.length === 0) {
    return '  (no dependency chain)';
  }
  return chain.map((name, i) => {
    const indent = '  '.repeat(i);
    return indent + '-> ' + name;
  }).join('\n');
}

/**
 * Format available items as a bulleted list
 */
export function formatAvailableList(items: string[], maxItems = 10): string {
  if (items.length === 0) {
    return '  (none available)';
  }
  
  const displayItems = items.slice(0, maxItems);
  const result = displayItems.map(item => '  - ' + item).join('\n');
  
  if (items.length > maxItems) {
    return result + '\n  ... and ' + (items.length - maxItems) + ' more';
  }
  
  return result;
}

/**
 * Format suggestions as a numbered list
 */
export function formatSuggestions(suggestions: string[]): string {
  return suggestions.map((s, i) => '  ' + (i + 1) + '. ' + s).join('\n');
}

/**
 * Format context information
 */
export function formatContext(context: Record<string, string | undefined>): string {
  const entries = Object.entries(context)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => '  ' + key + ': ' + value);
  
  return entries.length > 0 ? entries.join('\n') : '';
}

/**
 * Documentation links for common error types
 */
export const DOC_LINKS = {
  DI_GETTING_STARTED: 'https://titan.dev/docs/di/getting-started',
  DI_PROVIDERS: 'https://titan.dev/docs/di/providers',
  DI_SCOPES: 'https://titan.dev/docs/di/scopes',
  DI_MODULES: 'https://titan.dev/docs/di/modules',
  DI_CIRCULAR_DEPS: 'https://titan.dev/docs/di/circular-dependencies',
  DI_ASYNC: 'https://titan.dev/docs/di/async-providers',
  NETRON_SERVICES: 'https://titan.dev/docs/netron/services',
  NETRON_TRANSPORTS: 'https://titan.dev/docs/netron/transports',
  VALIDATION: 'https://titan.dev/docs/validation',
} as const;

/**
 * Build an actionable error message with sections
 */
export function buildActionableMessage(options: {
  title: string;
  description?: string;
  context?: Record<string, string | undefined>;
  chain?: string[];
  suggestions?: string[];
  availableItems?: { label: string; items: string[] };
  docLink?: string;
}): string {
  const sections: string[] = [];
  
  // Title line
  sections.push(options.title);
  
  // Description
  if (options.description) {
    sections.push('');
    sections.push(options.description);
  }
  
  // Context information
  if (options.context) {
    const contextStr = formatContext(options.context);
    if (contextStr) {
      sections.push('');
      sections.push('Context:');
      sections.push(contextStr);
    }
  }
  
  // Resolution chain
  if (options.chain && options.chain.length > 0) {
    sections.push('');
    sections.push('Resolution chain:');
    sections.push(formatResolutionChain(options.chain));
  }
  
  // Available items
  if (options.availableItems && options.availableItems.items.length > 0) {
    sections.push('');
    sections.push(options.availableItems.label + ':');
    sections.push(formatAvailableList(options.availableItems.items));
  }
  
  // Suggestions
  if (options.suggestions && options.suggestions.length > 0) {
    sections.push('');
    sections.push('How to fix:');
    sections.push(formatSuggestions(options.suggestions));
  }
  
  // Documentation link
  if (options.docLink) {
    sections.push('');
    sections.push('Documentation: ' + options.docLink);
  }
  
  return sections.join('\n');
}
