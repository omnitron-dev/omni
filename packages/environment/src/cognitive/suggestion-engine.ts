/**
 * Suggestion Engine
 * Generates configuration optimization suggestions
 */

import { Pattern } from './pattern-analyzer.js';

export interface Suggestion {
  id: string;
  type: 'optimization' | 'security' | 'performance' | 'cost';
  title: string;
  description: string;
  priority: 'low' | 'medium' | 'high';
  impact?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

export class SuggestionEngine {
  private suggestions: Map<string, Suggestion>;
  private nextId: number;

  constructor() {
    this.suggestions = new Map();
    this.nextId = 1;
  }

  /**
   * Generate suggestions from patterns
   */
  generateFromPatterns(patterns: Pattern[]): Suggestion[] {
    const newSuggestions: Suggestion[] = [];

    for (const pattern of patterns) {
      if (pattern.type === 'frequent' && pattern.confidence > 0.7) {
        const suggestion: Suggestion = {
          id: this.generateId(),
          type: 'performance',
          title: 'Consider caching frequently accessed configuration',
          description: `Keys ${pattern.keys.join(', ')} are accessed frequently`,
          priority: 'medium',
          impact: 'May improve read performance by 20-30%',
          action: 'Enable caching for these keys',
        };
        newSuggestions.push(suggestion);
        this.addSuggestion(suggestion);
      }
    }

    return newSuggestions;
  }

  /**
   * Add a suggestion
   */
  addSuggestion(suggestion: Suggestion): void {
    this.suggestions.set(suggestion.id, suggestion);
  }

  /**
   * Get all suggestions
   */
  getSuggestions(): Suggestion[] {
    return Array.from(this.suggestions.values());
  }

  /**
   * Get suggestions by type
   */
  getSuggestionsByType(type: Suggestion['type']): Suggestion[] {
    return this.getSuggestions().filter((s) => s.type === type);
  }

  /**
   * Get suggestions by priority
   */
  getSuggestionsByPriority(priority: Suggestion['priority']): Suggestion[] {
    return this.getSuggestions().filter((s) => s.priority === priority);
  }

  /**
   * Dismiss a suggestion
   */
  dismiss(id: string): boolean {
    return this.suggestions.delete(id);
  }

  /**
   * Clear all suggestions
   */
  clear(): void {
    this.suggestions.clear();
  }

  private generateId(): string {
    return `suggestion-${this.nextId++}`;
  }
}
