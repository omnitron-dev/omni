/**
 * LLM Integration - Semantic Understanding for Component Composition
 *
 * This module enables AI to understand and work with the ontological system.
 * It provides semantic search, natural language queries, and intelligent suggestions.
 *
 * Philosophy:
 * - Components have semantic meaning beyond their types
 * - LLMs can understand and reason about ontological constraints
 * - Natural language is a valid interface for component discovery
 *
 * @module ontology/llm/semantic-understanding
 */

import type { Component, ComponentMetadata } from '../core/composition.js';
import type { Capability, CapabilityRequirements } from '../core/capabilities.js';
import type { ProtocolName } from '../core/protocols.js';

/**
 * Semantic Embedding - Vector representation of a component
 */
export interface SemanticEmbedding {
  readonly componentId: string;
  readonly vector: Float32Array;
  readonly dimensions: number;
  readonly model: string;
}

/**
 * Semantic Index - Stores and queries component embeddings
 */
export interface SemanticIndex {
  /**
   * Add a component to the index
   */
  add(component: Component, embedding: SemanticEmbedding): Promise<void>;

  /**
   * Search for similar components
   */
  search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult[]>;

  /**
   * Find components by semantic similarity
   */
  findSimilar(component: Component, limit?: number): Promise<Component[]>;

  /**
   * Remove a component from the index
   */
  remove(componentId: string): Promise<void>;
}

/**
 * Semantic Search Options
 */
export interface SemanticSearchOptions {
  limit?: number;
  threshold?: number;
  filters?: SemanticFilters;
}

/**
 * Semantic Filters
 */
export interface SemanticFilters {
  capabilities?: string[];
  protocols?: ProtocolName[];
  tags?: string[];
  author?: string;
  deprecated?: boolean;
}

/**
 * Semantic Search Result
 */
export interface SemanticSearchResult {
  component: Component;
  score: number;
  explanation?: string;
}

/**
 * LLM Provider - Abstract interface for LLM interactions
 */
export interface LLMProvider {
  /**
   * Generate embeddings for text
   */
  embed(text: string): Promise<Float32Array>;

  /**
   * Complete a prompt
   */
  complete(prompt: string, options?: LLMCompletionOptions): Promise<string>;

  /**
   * Extract structured data from text
   */
  extract<T>(text: string, schema: any): Promise<T>;
}

/**
 * LLM Completion Options
 */
export interface LLMCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  stopSequences?: string[];
  systemPrompt?: string;
}

/**
 * Component Semantic Analyzer
 */
export class ComponentSemanticAnalyzer {
  constructor(private llm: LLMProvider) {}

  /**
   * Generate semantic description of a component
   */
  async describe(component: Component): Promise<string> {
    const prompt = `
Describe this software component in natural language:

Name: ${component.name}
Version: ${component.version}
Input Type: ${component.inputType.name}
Output Type: ${component.outputType.name}
Input Protocol: ${component.inputProtocol}
Output Protocol: ${component.outputProtocol}
Capabilities: ${component.capabilities.capabilities.map((c) => c.name).join(', ')}
Requirements: ${component.requirements.required.join(', ')}

${component.metadata.description ? `Description: ${component.metadata.description}` : ''}

Provide a concise, semantic description that captures:
1. What the component does
2. What kind of data it processes
3. What protocols it uses
4. What capabilities it provides
    `.trim();

    return await this.llm.complete(prompt, {
      temperature: 0.3,
      maxTokens: 200,
    });
  }

  /**
   * Generate embedding for a component
   */
  async generateEmbedding(component: Component): Promise<SemanticEmbedding> {
    // Combine all semantic information
    const text = [
      component.name,
      component.metadata.description || '',
      component.inputType.name,
      component.outputType.name,
      component.inputProtocol,
      component.outputProtocol,
      ...component.capabilities.capabilities.map((c) => c.name),
      ...component.requirements.required,
      ...(component.metadata.tags || []),
    ].join(' ');

    const vector = await this.llm.embed(text);

    return {
      componentId: component.id,
      vector,
      dimensions: vector.length,
      model: 'text-embedding-3-small', // Example model
    };
  }

  /**
   * Extract semantic intent from natural language query
   */
  async extractIntent(query: string): Promise<ComponentSearchIntent> {
    const prompt = `
Analyze this natural language query and extract the search intent:

Query: "${query}"

Extract:
1. What kind of component is being searched for?
2. What input/output types are expected?
3. What protocols are needed?
4. What capabilities are required?
5. Any other constraints?

Return as JSON following this schema:
{
  "description": "semantic description",
  "inputType": "expected input type or null",
  "outputType": "expected output type or null",
  "protocols": ["list", "of", "protocols"],
  "capabilities": ["list", "of", "capabilities"],
  "tags": ["relevant", "tags"]
}
    `.trim();

    return await this.llm.extract<ComponentSearchIntent>(prompt, {
      description: 'string',
      inputType: 'string | null',
      outputType: 'string | null',
      protocols: 'string[]',
      capabilities: 'string[]',
      tags: 'string[]',
    });
  }

  /**
   * Explain why two components can or cannot be composed
   */
  async explainComposition(from: Component, to: Component, canCompose: boolean): Promise<string> {
    const prompt = `
Explain ${canCompose ? 'why' : 'why not'} these two components can be composed:

Component A: ${from.name}
  - Output Type: ${from.outputType.name}
  - Output Protocol: ${from.outputProtocol}
  - Capabilities: ${from.capabilities.capabilities.map((c) => c.name).join(', ')}

Component B: ${to.name}
  - Input Type: ${to.inputType.name}
  - Input Protocol: ${to.inputProtocol}
  - Requirements: ${to.requirements.required.join(', ')}

Provide a clear, concise explanation in natural language.
${!canCompose ? 'Also suggest how to fix the incompatibility.' : ''}
    `.trim();

    return await this.llm.complete(prompt, {
      temperature: 0.5,
      maxTokens: 300,
    });
  }

  /**
   * Suggest components that could bridge a composition gap
   */
  async suggestBridge(from: Component, to: Component): Promise<ComponentSuggestion[]> {
    const prompt = `
Suggest intermediate components that could bridge these two components:

From: ${from.name}
  - Output Type: ${from.outputType.name}
  - Output Protocol: ${from.outputProtocol}

To: ${to.name}
  - Input Type: ${to.inputType.name}
  - Input Protocol: ${to.inputProtocol}

What kind of transformer, adapter, or intermediate component would work?

Return as JSON array:
[
  {
    "name": "suggested component name",
    "purpose": "what it does",
    "inputType": "input type",
    "outputType": "output type",
    "capabilities": ["needed", "capabilities"]
  }
]
    `.trim();

    return await this.llm.extract<ComponentSuggestion[]>(prompt, {
      type: 'array',
      items: {
        name: 'string',
        purpose: 'string',
        inputType: 'string',
        outputType: 'string',
        capabilities: 'string[]',
      },
    });
  }
}

/**
 * Component Search Intent
 */
export interface ComponentSearchIntent {
  description: string;
  inputType?: string | null;
  outputType?: string | null;
  protocols: string[];
  capabilities: string[];
  tags: string[];
}

/**
 * Component Suggestion
 */
export interface ComponentSuggestion {
  name: string;
  purpose: string;
  inputType: string;
  outputType: string;
  capabilities: string[];
}

/**
 * Semantic Component Registry - Enhanced registry with semantic search
 */
export class SemanticComponentRegistry {
  private components = new Map<string, Component>();
  private embeddings = new Map<string, SemanticEmbedding>();
  private analyzer: ComponentSemanticAnalyzer;

  constructor(private llm: LLMProvider) {
    this.analyzer = new ComponentSemanticAnalyzer(llm);
  }

  /**
   * Register a component with semantic indexing
   */
  async register(component: Component): Promise<void> {
    this.components.set(component.id, component);

    // Generate and store embedding
    const embedding = await this.analyzer.generateEmbedding(component);
    this.embeddings.set(component.id, embedding);
  }

  /**
   * Search components using natural language
   */
  async search(query: string, options?: SemanticSearchOptions): Promise<SemanticSearchResult[]> {
    // Extract intent from query
    const intent = await this.analyzer.extractIntent(query);

    // Generate embedding for query
    const queryEmbedding = await this.llm.embed(query);

    // Calculate similarities
    const results: SemanticSearchResult[] = [];

    for (const [id, component] of this.components) {
      const embedding = this.embeddings.get(id);
      if (!embedding) continue;

      // Apply filters
      if (options?.filters) {
        if (!this.matchesFilters(component, options.filters)) {
          continue;
        }
      }

      // Calculate cosine similarity
      const similarity = this.cosineSimilarity(queryEmbedding, embedding.vector);

      // Apply threshold
      if (options?.threshold && similarity < options.threshold) {
        continue;
      }

      results.push({
        component,
        score: similarity,
      });
    }

    // Sort by score
    results.sort((a, b) => b.score - a.score);

    // Apply limit
    if (options?.limit) {
      return results.slice(0, options.limit);
    }

    return results;
  }

  /**
   * Find components compatible with a given component
   */
  async findCompatible(component: Component): Promise<Component[]> {
    const compatible: Component[] = [];

    for (const candidate of this.components.values()) {
      if (candidate.id === component.id) continue;

      // Check if candidate's output matches component's input
      const outputMatches =
        candidate.outputType.name === component.inputType.name &&
        candidate.outputProtocol === component.inputProtocol;

      if (outputMatches) {
        compatible.push(candidate);
      }

      // Check if component's output matches candidate's input
      const inputMatches =
        component.outputType.name === candidate.inputType.name &&
        component.outputProtocol === candidate.inputProtocol;

      if (inputMatches) {
        compatible.push(candidate);
      }
    }

    return compatible;
  }

  /**
   * Explain a component in natural language
   */
  async explain(componentId: string): Promise<string> {
    const component = this.components.get(componentId);
    if (!component) {
      throw new Error(`Component not found: ${componentId}`);
    }

    return await this.analyzer.describe(component);
  }

  /**
   * Get all components
   */
  all(): Component[] {
    return Array.from(this.components.values());
  }

  /**
   * Get component by id
   */
  get(id: string): Component | undefined {
    return this.components.get(id);
  }

  /**
   * Check if filters match component
   */
  private matchesFilters(component: Component, filters: SemanticFilters): boolean {
    if (filters.capabilities) {
      const hasAllCapabilities = filters.capabilities.every((cap) => component.capabilities.has(cap));
      if (!hasAllCapabilities) return false;
    }

    if (filters.protocols) {
      const hasProtocol = filters.protocols.includes(component.inputProtocol as any);
      if (!hasProtocol) return false;
    }

    if (filters.tags && component.metadata.tags) {
      const hasTag = filters.tags.some((tag) => component.metadata.tags?.includes(tag));
      if (!hasTag) return false;
    }

    if (filters.author && component.metadata.author !== filters.author) {
      return false;
    }

    if (filters.deprecated !== undefined && component.metadata.deprecated !== filters.deprecated) {
      return false;
    }

    return true;
  }

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have the same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}

/**
 * Ontology Query Language - Natural language interface
 */
export class OntologyQueryLanguage {
  constructor(private registry: SemanticComponentRegistry) {}

  /**
   * Execute a natural language query
   */
  async query(query: string): Promise<OntologyQueryResult> {
    // Parse query type
    const type = this.detectQueryType(query);

    switch (type) {
      case 'search':
        return this.executeSearch(query);

      case 'compose':
        return this.executeCompose(query);

      case 'explain':
        return this.executeExplain(query);

      case 'suggest':
        return this.executeSuggest(query);

      default:
        throw new Error(`Unknown query type: ${type}`);
    }
  }

  /**
   * Detect query type from natural language
   */
  private detectQueryType(query: string): 'search' | 'compose' | 'explain' | 'suggest' {
    const lower = query.toLowerCase();

    if (lower.includes('find') || lower.includes('search') || lower.includes('component')) {
      return 'search';
    }

    if (lower.includes('compose') || lower.includes('connect') || lower.includes('combine')) {
      return 'compose';
    }

    if (lower.includes('explain') || lower.includes('why') || lower.includes('how')) {
      return 'explain';
    }

    if (lower.includes('suggest') || lower.includes('recommend') || lower.includes('what')) {
      return 'suggest';
    }

    return 'search'; // Default
  }

  /**
   * Execute search query
   */
  private async executeSearch(query: string): Promise<OntologyQueryResult> {
    const results = await this.registry.search(query, { limit: 10 });

    return {
      type: 'search',
      results: results.map((r) => r.component),
      explanation: `Found ${results.length} matching components`,
    };
  }

  /**
   * Execute compose query
   */
  private async executeCompose(query: string): Promise<OntologyQueryResult> {
    // Extract component names from query
    // This is simplified - real implementation would use NLP
    throw new Error('Compose query not yet implemented');
  }

  /**
   * Execute explain query
   */
  private async executeExplain(query: string): Promise<OntologyQueryResult> {
    // Extract component id from query
    // This is simplified - real implementation would use NLP
    throw new Error('Explain query not yet implemented');
  }

  /**
   * Execute suggest query
   */
  private async executeSuggest(query: string): Promise<OntologyQueryResult> {
    // Extract requirements from query
    // This is simplified - real implementation would use NLP
    throw new Error('Suggest query not yet implemented');
  }
}

/**
 * Ontology Query Result
 */
export interface OntologyQueryResult {
  type: 'search' | 'compose' | 'explain' | 'suggest';
  results?: Component[];
  explanation?: string;
  suggestions?: ComponentSuggestion[];
}
