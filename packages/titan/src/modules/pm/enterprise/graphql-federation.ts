/**
 * GraphQL Federation and API Gateway Implementation
 *
 * Provides federated GraphQL services with:
 * - Schema federation and stitching
 * - Entity resolution across services
 * - Query planning and execution
 * - Subgraph management
 * - Federation directives (@key, @requires, @provides, @extends, @external)
 */

import { EventEmitter } from 'events';

import { Errors } from '../../../errors/index.js';
import type { ILogger } from '../../logger/logger.types.js';

// ============================================================================
// Core Types and Interfaces
// ============================================================================

/**
 * Federation directive types
 */
export type FederationDirectiveType = 'key' | 'requires' | 'provides' | 'extends' | 'external' | 'shareable' | 'inaccessible' | 'override';

/**
 * Federation directive definition
 */
export interface FederationDirective {
  type: FederationDirectiveType;
  fields?: string;
  from?: string;
  reason?: string;
}

/**
 * GraphQL field definition
 */
export interface GraphQLFieldDefinition {
  name: string;
  type: string;
  args?: GraphQLArgumentDefinition[];
  directives?: FederationDirective[];
  resolver?: GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>>;
  description?: string;
  deprecationReason?: string;
}

/**
 * GraphQL argument definition
 */
export interface GraphQLArgumentDefinition {
  name: string;
  type: string;
  defaultValue?: unknown;
  description?: string;
}

/**
 * GraphQL type definition
 */
export interface GraphQLTypeDefinition {
  name: string;
  kind: 'object' | 'interface' | 'union' | 'enum' | 'input' | 'scalar';
  fields?: Map<string, GraphQLFieldDefinition>;
  interfaces?: string[];
  possibleTypes?: string[];
  enumValues?: string[];
  directives?: FederationDirective[];
  description?: string;
}

/**
 * GraphQL Service Configuration
 */
export interface GraphQLServiceConfig {
  name: string;
  schema: string;
  url?: string;
  federation?: boolean;
  directives?: GraphQLDirective[];
  entities?: EntityDefinition[];
  healthCheck?: HealthCheckConfig;
}

/**
 * Entity definition for federation
 */
export interface EntityDefinition {
  typeName: string;
  keyFields: string[];
  resolver: EntityResolver;
}

/**
 * Entity resolver function
 */
export type EntityResolver = (
  representations: EntityRepresentation[],
  context: GraphQLContext
) => Promise<(Record<string, unknown> | null)[]>;

/**
 * Entity representation for __resolveReference
 */
export interface EntityRepresentation {
  __typename: string;
  [key: string]: unknown;
}

/**
 * Health check configuration
 */
export interface HealthCheckConfig {
  enabled: boolean;
  interval?: number;
  timeout?: number;
}

/**
 * GraphQL Directive
 */
export interface GraphQLDirective {
  name: string;
  locations: DirectiveLocation[];
  args?: Record<string, GraphQLArgumentDefinition>;
  repeatable?: boolean;
}

/**
 * Directive location
 */
export type DirectiveLocation =
  | 'QUERY'
  | 'MUTATION'
  | 'SUBSCRIPTION'
  | 'FIELD'
  | 'FRAGMENT_DEFINITION'
  | 'FRAGMENT_SPREAD'
  | 'INLINE_FRAGMENT'
  | 'VARIABLE_DEFINITION'
  | 'SCHEMA'
  | 'SCALAR'
  | 'OBJECT'
  | 'FIELD_DEFINITION'
  | 'ARGUMENT_DEFINITION'
  | 'INTERFACE'
  | 'UNION'
  | 'ENUM'
  | 'ENUM_VALUE'
  | 'INPUT_OBJECT'
  | 'INPUT_FIELD_DEFINITION';

/**
 * GraphQL execution context
 */
export interface GraphQLContext {
  requestId: string;
  userId?: string;
  tenantId?: string;
  headers?: Record<string, string>;
  dataloaders?: Map<string, DataLoader<unknown, unknown>>;
  [key: string]: unknown;
}

/**
 * DataLoader interface for batching
 */
export interface DataLoader<K, V> {
  load(key: K): Promise<V>;
  loadMany(keys: K[]): Promise<(V | Error)[]>;
  clear(key: K): void;
  clearAll(): void;
  prime(key: K, value: V): void;
}

/**
 * GraphQL resolver info
 */
export interface GraphQLResolverInfo {
  fieldName: string;
  parentType: string;
  returnType: string;
  path: GraphQLPath;
  fragments: Map<string, GraphQLFragment>;
  variableValues: Record<string, unknown>;
}

/**
 * GraphQL path
 */
export interface GraphQLPath {
  key: string | number;
  prev?: GraphQLPath;
  typename?: string;
}

/**
 * GraphQL fragment
 */
export interface GraphQLFragment {
  name: string;
  typeCondition: string;
  selectionSet: GraphQLSelectionSet;
}

/**
 * GraphQL selection set
 */
export interface GraphQLSelectionSet {
  selections: GraphQLSelection[];
}

/**
 * GraphQL selection
 */
export type GraphQLSelection = GraphQLFieldSelection | GraphQLFragmentSpread | GraphQLInlineFragment;

/**
 * Field selection
 */
export interface GraphQLFieldSelection {
  kind: 'Field';
  name: string;
  alias?: string;
  arguments?: Record<string, unknown>;
  selectionSet?: GraphQLSelectionSet;
}

/**
 * Fragment spread
 */
export interface GraphQLFragmentSpread {
  kind: 'FragmentSpread';
  name: string;
}

/**
 * Inline fragment
 */
export interface GraphQLInlineFragment {
  kind: 'InlineFragment';
  typeCondition?: string;
  selectionSet: GraphQLSelectionSet;
}

/**
 * GraphQL Resolver
 */
export type GraphQLResolver<TSource = unknown, TContext = GraphQLContext, TArgs = Record<string, unknown>> = (
  source: TSource,
  args: TArgs,
  context: TContext,
  info: GraphQLResolverInfo
) => unknown | Promise<unknown>;

/**
 * GraphQL Subscription Resolver
 */
export interface GraphQLSubscriptionResolver<TSource = unknown, TContext = GraphQLContext, TArgs = Record<string, unknown>> {
  subscribe: (source: TSource, args: TArgs, context: TContext, info: GraphQLResolverInfo) => AsyncIterator<unknown>;
  resolve?: (payload: unknown, args: TArgs, context: TContext, info: GraphQLResolverInfo) => unknown;
}

/**
 * GraphQL execution result
 */
export interface GraphQLExecutionResult {
  data?: Record<string, unknown> | null;
  errors?: GraphQLError[];
  extensions?: Record<string, unknown>;
}

/**
 * GraphQL error
 */
export interface GraphQLError {
  message: string;
  locations?: Array<{ line: number; column: number }>;
  path?: Array<string | number>;
  extensions?: Record<string, unknown>;
}

/**
 * Parsed GraphQL operation
 */
export interface ParsedOperation {
  type: 'query' | 'mutation' | 'subscription';
  name?: string;
  selections: GraphQLSelection[];
  variables?: Record<string, unknown>;
  fragments: Map<string, GraphQLFragment>;
}

/**
 * Query plan for federated execution
 */
export interface QueryPlan {
  id: string;
  steps: QueryPlanStep[];
  parallelGroups: QueryPlanStep[][];
  estimatedCost: number;
}

/**
 * Query plan step
 */
export interface QueryPlanStep {
  id: string;
  service: string;
  query: string;
  variables?: Record<string, unknown>;
  dependencies: string[];
  entityReferences?: EntityRepresentation[];
  requires?: string[];
  provides?: string[];
}

/**
 * Subgraph status
 */
export interface SubgraphStatus {
  name: string;
  url?: string;
  healthy: boolean;
  lastCheck: number;
  latency?: number;
  errorCount: number;
}

// ============================================================================
// Schema Parser (Simplified)
// ============================================================================

/**
 * Schema parser for GraphQL SDL
 */
export class SchemaParser {
  private types = new Map<string, GraphQLTypeDefinition>();
  private directives = new Map<string, GraphQLDirective>();

  /**
   * Parse GraphQL SDL schema string
   */
  parse(schema: string): Map<string, GraphQLTypeDefinition> {
    // Reset state
    this.types.clear();

    // Parse type definitions
    this.parseTypeDefinitions(schema);

    // Parse federation directives
    this.parseFederationDirectives(schema);

    return this.types;
  }

  /**
   * Parse type definitions from schema
   */
  private parseTypeDefinitions(schema: string): void {
    // Match type definitions
    const typeRegex = /type\s+(\w+)(?:\s+@\w+(?:\([^)]*\))?)*\s*(?:implements\s+([\w\s&]+))?\s*\{([^}]+)\}/g;
    let match: RegExpExecArray | null;

    while ((match = typeRegex.exec(schema)) !== null) {
      const [, typeName, interfaces, fieldsBlock] = match;
      if (!typeName || !fieldsBlock) continue;

      const fields = this.parseFields(fieldsBlock);
      const directives = this.extractDirectives(match[0]);

      this.types.set(typeName, {
        name: typeName,
        kind: 'object',
        fields,
        interfaces: interfaces ? interfaces.split('&').map((i) => i.trim()) : undefined,
        directives,
      });
    }

    // Parse input types
    const inputRegex = /input\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = inputRegex.exec(schema)) !== null) {
      const [, typeName, fieldsBlock] = match;
      if (!typeName || !fieldsBlock) continue;

      const fields = this.parseFields(fieldsBlock);

      this.types.set(typeName, {
        name: typeName,
        kind: 'input',
        fields,
      });
    }

    // Parse enums
    const enumRegex = /enum\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = enumRegex.exec(schema)) !== null) {
      const [, typeName, valuesBlock] = match;
      if (!typeName || !valuesBlock) continue;

      const enumValues = valuesBlock
        .split('\n')
        .map((v) => v.trim())
        .filter((v) => v && !v.startsWith('#'));

      this.types.set(typeName, {
        name: typeName,
        kind: 'enum',
        enumValues,
      });
    }

    // Parse interfaces
    const interfaceRegex = /interface\s+(\w+)\s*\{([^}]+)\}/g;
    while ((match = interfaceRegex.exec(schema)) !== null) {
      const [, typeName, fieldsBlock] = match;
      if (!typeName || !fieldsBlock) continue;

      const fields = this.parseFields(fieldsBlock);

      this.types.set(typeName, {
        name: typeName,
        kind: 'interface',
        fields,
      });
    }

    // Parse unions
    const unionRegex = /union\s+(\w+)\s*=\s*([^#\n]+)/g;
    while ((match = unionRegex.exec(schema)) !== null) {
      const [, typeName, types] = match;
      if (!typeName || !types) continue;

      const possibleTypes = types.split('|').map((t) => t.trim());

      this.types.set(typeName, {
        name: typeName,
        kind: 'union',
        possibleTypes,
      });
    }
  }

  /**
   * Parse fields from a fields block
   */
  private parseFields(fieldsBlock: string): Map<string, GraphQLFieldDefinition> {
    const fields = new Map<string, GraphQLFieldDefinition>();
    const fieldRegex = /(\w+)(?:\(([^)]*)\))?\s*:\s*(\[?\w+!?\]?!?)(?:\s+@(\w+)(?:\(([^)]*)\))?)?/g;

    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(fieldsBlock)) !== null) {
      const [fullMatch, name, argsBlock, type, directiveName, directiveArgs] = match;
      if (!name || !type) continue;

      const args = argsBlock ? this.parseArguments(argsBlock) : undefined;
      const directives = directiveName ? this.parseFieldDirective(directiveName, directiveArgs) : undefined;

      fields.set(name, {
        name,
        type,
        args,
        directives,
      });
    }

    return fields;
  }

  /**
   * Parse arguments from arguments block
   */
  private parseArguments(argsBlock: string): GraphQLArgumentDefinition[] {
    const args: GraphQLArgumentDefinition[] = [];
    const argRegex = /(\w+)\s*:\s*(\[?\w+!?\]?!?)(?:\s*=\s*([^,\n)]+))?/g;

    let match: RegExpExecArray | null;
    while ((match = argRegex.exec(argsBlock)) !== null) {
      const [, name, type, defaultValue] = match;
      if (!name || !type) continue;

      args.push({
        name,
        type,
        defaultValue: defaultValue ? this.parseValue(defaultValue.trim()) : undefined,
      });
    }

    return args;
  }

  /**
   * Parse a value string into its JavaScript representation
   */
  private parseValue(value: string): unknown {
    if (value === 'null') return null;
    if (value === 'true') return true;
    if (value === 'false') return false;
    if (/^\d+$/.test(value)) return parseInt(value, 10);
    if (/^\d+\.\d+$/.test(value)) return parseFloat(value);
    if (value.startsWith('"') && value.endsWith('"')) {
      return value.slice(1, -1);
    }
    return value; // Enum value or other
  }

  /**
   * Parse field directive
   */
  private parseFieldDirective(name: string, argsStr?: string): FederationDirective[] {
    const directive: FederationDirective = {
      type: name as FederationDirectiveType,
    };

    if (argsStr) {
      const fieldsMatch = /fields:\s*"([^"]+)"/.exec(argsStr);
      if (fieldsMatch?.[1]) {
        directive.fields = fieldsMatch[1];
      }

      const fromMatch = /from:\s*"([^"]+)"/.exec(argsStr);
      if (fromMatch?.[1]) {
        directive.from = fromMatch[1];
      }
    }

    return [directive];
  }

  /**
   * Extract directives from type definition
   */
  private extractDirectives(typeDefinition: string): FederationDirective[] {
    const directives: FederationDirective[] = [];
    const directiveRegex = /@(\w+)(?:\(([^)]*)\))?/g;

    let match: RegExpExecArray | null;
    while ((match = directiveRegex.exec(typeDefinition)) !== null) {
      const [, name, args] = match;
      if (!name) continue;

      const directive: FederationDirective = {
        type: name as FederationDirectiveType,
      };

      if (args) {
        const fieldsMatch = /fields:\s*"([^"]+)"/.exec(args);
        if (fieldsMatch?.[1]) {
          directive.fields = fieldsMatch[1];
        }
      }

      directives.push(directive);
    }

    return directives;
  }

  /**
   * Parse federation directives from schema
   */
  private parseFederationDirectives(schema: string): void {
    // Check for @key directive on types
    const keyRegex = /type\s+(\w+)[^{]*@key\s*\(\s*fields:\s*"([^"]+)"\s*\)/g;
    let match: RegExpExecArray | null;

    while ((match = keyRegex.exec(schema)) !== null) {
      const [, typeName, fields] = match;
      if (!typeName) continue;

      const type = this.types.get(typeName);
      if (type) {
        const directives = type.directives ?? [];
        directives.push({ type: 'key', fields });
        type.directives = directives;
      }
    }
  }

  /**
   * Get entity types (types with @key directive)
   */
  getEntityTypes(): Map<string, GraphQLTypeDefinition> {
    const entities = new Map<string, GraphQLTypeDefinition>();

    for (const [name, type] of this.types) {
      if (type.directives?.some((d) => d.type === 'key')) {
        entities.set(name, type);
      }
    }

    return entities;
  }

  /**
   * Get key fields for an entity type
   */
  getKeyFields(typeName: string): string[] {
    const type = this.types.get(typeName);
    if (!type) return [];

    const keyDirective = type.directives?.find((d) => d.type === 'key');
    if (!keyDirective?.fields) return [];

    return keyDirective.fields.split(/\s+/).filter(Boolean);
  }
}

// ============================================================================
// GraphQL Service
// ============================================================================

/**
 * GraphQL Service Definition
 *
 * Manages a single GraphQL service with resolvers, subscriptions, and entity resolution.
 */
export class GraphQLService extends EventEmitter {
  private resolvers = new Map<string, Map<string, GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>>>>();
  private subscriptions = new Map<string, Map<string, GraphQLSubscriptionResolver<unknown, GraphQLContext, Record<string, unknown>>>>();
  private entityResolvers = new Map<string, EntityResolver>();
  private schemaParser: SchemaParser;
  private parsedTypes: Map<string, GraphQLTypeDefinition>;
  private readonly serviceName: string;

  constructor(
    private readonly config: GraphQLServiceConfig,
    private readonly logger?: ILogger
  ) {
    super();
    this.serviceName = config.name;
    this.schemaParser = new SchemaParser();
    this.parsedTypes = this.schemaParser.parse(config.schema);

    // Register entity resolvers from config
    if (config.entities) {
      for (const entity of config.entities) {
        this.registerEntityResolver(entity.typeName, entity.keyFields, entity.resolver);
      }
    }
  }

  /**
   * Get service name
   */
  getName(): string {
    return this.serviceName;
  }

  /**
   * Add resolver for a type and field
   */
  addResolver(
    type: 'Query' | 'Mutation' | 'Subscription' | string,
    field: string,
    resolver: GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>> | GraphQLSubscriptionResolver<unknown, GraphQLContext, Record<string, unknown>>
  ): void {
    if (type === 'Subscription') {
      if (!this.subscriptions.has(type)) {
        this.subscriptions.set(type, new Map());
      }
      this.subscriptions.get(type)!.set(field, resolver as GraphQLSubscriptionResolver<unknown, GraphQLContext, Record<string, unknown>>);
    } else {
      if (!this.resolvers.has(type)) {
        this.resolvers.set(type, new Map());
      }
      this.resolvers.get(type)!.set(field, resolver as GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>>);
    }

    this.emit('resolver:added', { type, field });
  }

  /**
   * Register an entity resolver for federation
   */
  registerEntityResolver(typeName: string, keyFields: string[], resolver: EntityResolver): void {
    this.entityResolvers.set(typeName, resolver);
    this.emit('entity:registered', { typeName, keyFields });
  }

  /**
   * Resolve entity references (for federation)
   */
  async resolveEntities(representations: EntityRepresentation[], context: GraphQLContext): Promise<(Record<string, unknown> | null)[]> {
    // Group representations by typename
    const grouped = new Map<string, { indices: number[]; reps: EntityRepresentation[] }>();

    for (let i = 0; i < representations.length; i++) {
      const rep = representations[i];
      if (!rep) continue;

      const typename = rep.__typename;
      if (!grouped.has(typename)) {
        grouped.set(typename, { indices: [], reps: [] });
      }
      const group = grouped.get(typename)!;
      group.indices.push(i);
      group.reps.push(rep);
    }

    // Resolve each group
    const results: (Record<string, unknown> | null)[] = new Array(representations.length).fill(null);

    for (const [typename, { indices, reps }] of grouped) {
      const resolver = this.entityResolvers.get(typename);
      if (!resolver) {
        this.logger?.warn({ typename }, 'No entity resolver found');
        continue;
      }

      try {
        const resolved = await resolver(reps, context);
        for (let i = 0; i < indices.length; i++) {
          const idx = indices[i];
          const value = resolved[i];
          if (idx !== undefined && value !== undefined) {
            results[idx] = value;
          }
        }
      } catch (error) {
        this.logger?.error({ error, typename }, 'Entity resolution failed');
        this.emit('entity:error', { typename, error });
      }
    }

    return results;
  }

  /**
   * Execute a GraphQL query/mutation
   */
  async execute(
    query: string,
    variables?: Record<string, unknown>,
    context?: GraphQLContext
  ): Promise<GraphQLExecutionResult> {
    const ctx = context ?? this.createDefaultContext();

    try {
      // Parse query
      const operation = this.parseQuery(query);

      if (operation.type === 'subscription') {
        // Return the subscription iterator wrapped in a result
        const iterator = await this.subscribe(operation, variables, ctx);
        return {
          data: { __subscription: iterator } as Record<string, unknown>,
        };
      }

      return await this.resolve(operation, variables, ctx);
    } catch (error) {
      this.emit('execution:error', { error, query });
      return {
        data: null,
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
            extensions: { code: 'EXECUTION_ERROR' },
          },
        ],
      };
    }
  }

  /**
   * Create default execution context
   */
  private createDefaultContext(): GraphQLContext {
    return {
      requestId: `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
  }

  /**
   * Parse GraphQL query string
   */
  private parseQuery(query: string): ParsedOperation {
    // Determine operation type
    const isSubscription = /\bsubscription\b/i.test(query);
    const isMutation = /\bmutation\b/i.test(query);
    const type = isSubscription ? 'subscription' : isMutation ? 'mutation' : 'query';

    // Extract operation name
    const nameMatch = query.match(new RegExp(`${type}\\s+(\\w+)`, 'i'));
    const name = nameMatch?.[1];

    // Extract selections
    const selections = this.parseSelections(query);

    // Extract fragments
    const fragments = this.parseFragments(query);

    return {
      type,
      name,
      selections,
      fragments,
    };
  }

  /**
   * Parse selections from query
   */
  private parseSelections(query: string): GraphQLSelection[] {
    const selections: GraphQLSelection[] = [];

    // Find the main selection set
    const mainBlockMatch = query.match(/\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/);
    if (!mainBlockMatch?.[1]) return selections;

    const block = mainBlockMatch[1];

    // Parse field selections
    const fieldRegex = /(\w+)(?:\s*\(([^)]*)\))?(?:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\})?/g;
    let match: RegExpExecArray | null;

    while ((match = fieldRegex.exec(block)) !== null) {
      const [, fieldName, argsStr, nestedBlock] = match;
      if (!fieldName) continue;

      const selection: GraphQLFieldSelection = {
        kind: 'Field',
        name: fieldName,
      };

      if (argsStr) {
        selection.arguments = this.parseArgumentValues(argsStr);
      }

      if (nestedBlock) {
        selection.selectionSet = {
          selections: this.parseNestedSelections(nestedBlock),
        };
      }

      selections.push(selection);
    }

    return selections;
  }

  /**
   * Parse nested selections
   */
  private parseNestedSelections(block: string): GraphQLSelection[] {
    const selections: GraphQLSelection[] = [];
    const fieldRegex = /(\w+)(?:\s*:\s*(\w+))?(?:\s*\(([^)]*)\))?/g;

    let match: RegExpExecArray | null;
    while ((match = fieldRegex.exec(block)) !== null) {
      const [, nameOrAlias, actualName] = match;
      if (!nameOrAlias) continue;

      selections.push({
        kind: 'Field',
        name: actualName ?? nameOrAlias,
        alias: actualName ? nameOrAlias : undefined,
      });
    }

    return selections;
  }

  /**
   * Parse argument values from string
   */
  private parseArgumentValues(argsStr: string): Record<string, unknown> {
    const args: Record<string, unknown> = {};
    const argRegex = /(\w+)\s*:\s*(\$?\w+|"[^"]*"|\d+(?:\.\d+)?|true|false|null|\[[^\]]*\]|\{[^}]*\})/g;

    let match: RegExpExecArray | null;
    while ((match = argRegex.exec(argsStr)) !== null) {
      const [, name, value] = match;
      if (!name || value === undefined) continue;

      if (value.startsWith('$')) {
        args[name] = { __variable: value.slice(1) };
      } else if (value === 'null') {
        args[name] = null;
      } else if (value === 'true') {
        args[name] = true;
      } else if (value === 'false') {
        args[name] = false;
      } else if (value.startsWith('"')) {
        args[name] = value.slice(1, -1);
      } else if (/^\d/.test(value)) {
        args[name] = value.includes('.') ? parseFloat(value) : parseInt(value, 10);
      } else {
        args[name] = value;
      }
    }

    return args;
  }

  /**
   * Parse fragments from query
   */
  private parseFragments(query: string): Map<string, GraphQLFragment> {
    const fragments = new Map<string, GraphQLFragment>();
    const fragmentRegex = /fragment\s+(\w+)\s+on\s+(\w+)\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g;

    let match: RegExpExecArray | null;
    while ((match = fragmentRegex.exec(query)) !== null) {
      const [, name, typeCondition, block] = match;
      if (!name || !typeCondition || !block) continue;

      fragments.set(name, {
        name,
        typeCondition,
        selectionSet: {
          selections: this.parseNestedSelections(block),
        },
      });
    }

    return fragments;
  }

  /**
   * Resolve a parsed operation
   */
  private async resolve(
    operation: ParsedOperation,
    variables?: Record<string, unknown>,
    context?: GraphQLContext
  ): Promise<GraphQLExecutionResult> {
    const type = operation.type === 'mutation' ? 'Mutation' : 'Query';
    const resolvers = this.resolvers.get(type);

    if (!resolvers) {
      return {
        data: null,
        errors: [{ message: `No resolvers registered for ${type}` }],
      };
    }

    const data: Record<string, unknown> = {};
    const errors: GraphQLError[] = [];
    const ctx = context ?? this.createDefaultContext();

    for (const selection of operation.selections) {
      if (selection.kind !== 'Field') continue;

      const field = selection.name;
      const resolver = resolvers.get(field);

      if (!resolver) {
        errors.push({
          message: `No resolver for field ${type}.${field}`,
          path: [field],
        });
        continue;
      }

      try {
        // Resolve variables in arguments
        const resolvedArgs = this.resolveArguments(selection.arguments ?? {}, variables ?? {});

        const info: GraphQLResolverInfo = {
          fieldName: field,
          parentType: type,
          returnType: 'unknown',
          path: { key: field },
          fragments: operation.fragments,
          variableValues: variables ?? {},
        };

        const result = await resolver({}, resolvedArgs, ctx, info);
        data[selection.alias ?? field] = result as Record<string, unknown>[string];
      } catch (error) {
        errors.push({
          message: error instanceof Error ? error.message : String(error),
          path: [field],
          extensions: { code: 'RESOLVER_ERROR' },
        });
      }
    }

    return {
      data: Object.keys(data).length > 0 ? data : null,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  /**
   * Resolve variable references in arguments
   */
  private resolveArguments(
    args: Record<string, unknown>,
    variables: Record<string, unknown>
  ): Record<string, unknown> {
    const resolved: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(args)) {
      if (value && typeof value === 'object' && '__variable' in value) {
        const varName = (value as { __variable: string }).__variable;
        resolved[key] = variables[varName];
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        resolved[key] = this.resolveArguments(value as Record<string, unknown>, variables);
      } else {
        resolved[key] = value;
      }
    }

    return resolved;
  }

  /**
   * Subscribe to a subscription operation
   */
  private async subscribe(
    operation: ParsedOperation,
    variables?: Record<string, unknown>,
    context?: GraphQLContext
  ): Promise<AsyncIterator<unknown>> {
    const subscriptions = this.subscriptions.get('Subscription');

    if (!subscriptions) {
      throw Errors.notFound('No subscription resolvers registered');
    }

    // Get the first field selection for the subscription
    const firstSelection = operation.selections.find((s): s is GraphQLFieldSelection => s.kind === 'Field');
    if (!firstSelection) {
      throw Errors.badRequest('No field selection in subscription');
    }

    const field = firstSelection.name;
    const subscription = subscriptions.get(field);

    if (!subscription) {
      throw Errors.notFound(`Subscription resolver`, field);
    }

    const ctx = context ?? this.createDefaultContext();
    const resolvedArgs = this.resolveArguments(firstSelection.arguments ?? {}, variables ?? {});

    const info: GraphQLResolverInfo = {
      fieldName: field,
      parentType: 'Subscription',
      returnType: 'unknown',
      path: { key: field },
      fragments: operation.fragments,
      variableValues: variables ?? {},
    };

    return subscription.subscribe({}, resolvedArgs, ctx, info);
  }

  /**
   * Get the raw schema string
   */
  getSchema(): string {
    return this.config.schema;
  }

  /**
   * Get parsed type definitions
   */
  getTypes(): Map<string, GraphQLTypeDefinition> {
    return this.parsedTypes;
  }

  /**
   * Get entity types (types with @key directive)
   */
  getEntityTypes(): Map<string, GraphQLTypeDefinition> {
    return this.schemaParser.getEntityTypes();
  }

  /**
   * Check if this service can resolve an entity type
   */
  canResolveEntity(typeName: string): boolean {
    return this.entityResolvers.has(typeName);
  }

  /**
   * Get registered resolvers for a type
   */
  getResolvers(type: string): Map<string, GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>>> | undefined {
    return this.resolvers.get(type);
  }
}

// ============================================================================
// GraphQL Federation Gateway
// ============================================================================

/**
 * Gateway configuration
 */
export interface FederationGatewayConfig {
  services: GraphQLServiceConfig[];
  polling?: number;
  cache?: boolean;
  cacheMaxAge?: number;
  introspection?: boolean;
  queryPlanCaching?: boolean;
  healthCheckInterval?: number;
  timeout?: number;
}

/**
 * Query plan cache entry
 */
interface QueryPlanCacheEntry {
  plan: QueryPlan;
  createdAt: number;
  hitCount: number;
}

/**
 * Execution result from a service
 */
interface ServiceExecutionResult {
  service: string;
  result?: GraphQLExecutionResult;
  error?: Error;
  latency: number;
}

/**
 * GraphQL Federation Gateway
 *
 * Coordinates query execution across multiple GraphQL services with:
 * - Query planning and optimization
 * - Entity resolution across services
 * - Schema stitching
 * - Health monitoring
 * - Result merging
 */
export class GraphQLFederationGateway extends EventEmitter {
  private services = new Map<string, GraphQLService>();
  private serviceStatus = new Map<string, SubgraphStatus>();
  private federatedSchema: string = '';
  private entityOwnership = new Map<string, Set<string>>(); // typeName -> serviceNames
  private queryPlanCache = new Map<string, QueryPlanCacheEntry>();
  private healthCheckInterval?: ReturnType<typeof setInterval>;
  private planIdCounter = 0;

  constructor(
    private readonly config: FederationGatewayConfig,
    private readonly logger?: ILogger
  ) {
    super();
    this.initializeServices();

    if (config.healthCheckInterval) {
      this.startHealthChecks();
    }
  }

  /**
   * Initialize services from configuration
   */
  private initializeServices(): void {
    for (const serviceConfig of this.config.services) {
      const service = new GraphQLService(serviceConfig, this.logger);
      this.services.set(serviceConfig.name, service);

      // Initialize status
      this.serviceStatus.set(serviceConfig.name, {
        name: serviceConfig.name,
        url: serviceConfig.url,
        healthy: true,
        lastCheck: Date.now(),
        errorCount: 0,
      });

      // Track entity ownership
      const entityTypes = service.getEntityTypes();
      for (const [typeName] of entityTypes) {
        if (!this.entityOwnership.has(typeName)) {
          this.entityOwnership.set(typeName, new Set());
        }
        this.entityOwnership.get(typeName)!.add(serviceConfig.name);
      }
    }

    this.buildFederatedSchema();
    this.logger?.info({ serviceCount: this.services.size }, 'Federation gateway initialized');
  }

  /**
   * Build the federated schema by stitching service schemas
   */
  private buildFederatedSchema(): void {
    const schemaBuilder = new FederatedSchemaBuilder();

    for (const [name, service] of this.services) {
      schemaBuilder.addService(name, service.getSchema(), service.getTypes());
    }

    this.federatedSchema = schemaBuilder.build();
    this.emit('schema:built', { services: this.services.size });
  }

  /**
   * Execute a federated GraphQL query
   */
  async execute(
    query: string,
    variables?: Record<string, unknown>,
    context?: GraphQLContext
  ): Promise<GraphQLExecutionResult> {
    const ctx = context ?? {
      requestId: `gw-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };

    const startTime = Date.now();

    try {
      // Create or retrieve cached query plan
      const plan = this.getOrCreateQueryPlan(query);

      this.emit('query:planning', { planId: plan.id, stepCount: plan.steps.length });

      // Execute the plan
      const results = await this.executePlan(plan, variables, ctx);

      // Merge results from all services
      const merged = this.mergeResults(results, plan);

      const executionTime = Date.now() - startTime;
      this.emit('query:executed', {
        planId: plan.id,
        executionTime,
        serviceCount: results.length,
      });

      // Add execution metadata to extensions
      if (merged.extensions === undefined) {
        merged.extensions = {};
      }
      merged.extensions['federation'] = {
        planId: plan.id,
        executionTime,
        servicesQueried: results.map((r) => r.service),
      };

      return merged;
    } catch (error) {
      this.logger?.error({ error, query }, 'Federation execution failed');
      this.emit('query:error', { error, query });

      return {
        data: null,
        errors: [
          {
            message: error instanceof Error ? error.message : String(error),
            extensions: { code: 'FEDERATION_ERROR' },
          },
        ],
      };
    }
  }

  /**
   * Get or create a query plan (with caching)
   */
  private getOrCreateQueryPlan(query: string): QueryPlan {
    const queryHash = this.hashQuery(query);

    if (this.config.queryPlanCaching) {
      const cached = this.queryPlanCache.get(queryHash);
      if (cached) {
        cached.hitCount++;
        return cached.plan;
      }
    }

    const plan = this.createQueryPlan(query);

    if (this.config.queryPlanCaching) {
      this.queryPlanCache.set(queryHash, {
        plan,
        createdAt: Date.now(),
        hitCount: 0,
      });
    }

    return plan;
  }

  /**
   * Create a query execution plan
   */
  private createQueryPlan(query: string): QueryPlan {
    const planId = `plan-${++this.planIdCounter}`;
    const steps: QueryPlanStep[] = [];
    const parallelGroups: QueryPlanStep[][] = [];

    // Analyze the query to determine which services need to be queried
    const requiredServices = this.analyzeQueryRequirements(query);

    // Build execution steps for each service
    let stepId = 0;
    for (const serviceName of requiredServices.initialServices) {
      steps.push({
        id: `${planId}-step-${++stepId}`,
        service: serviceName,
        query,
        dependencies: [],
      });
    }

    // Add entity resolution steps for cross-service references
    for (const [typeName, services] of requiredServices.entityResolutions) {
      for (const serviceName of services) {
        const step: QueryPlanStep = {
          id: `${planId}-step-${++stepId}`,
          service: serviceName,
          query: this.buildEntityResolutionQuery(typeName),
          dependencies: steps.filter((s) => s.service !== serviceName).map((s) => s.id),
          entityReferences: [],
        };
        steps.push(step);
      }
    }

    // Group steps into parallel execution groups
    const grouped = this.groupStepsForParallelExecution(steps);

    return {
      id: planId,
      steps,
      parallelGroups: grouped,
      estimatedCost: this.estimateQueryCost(steps),
    };
  }

  /**
   * Analyze query to determine service requirements
   */
  private analyzeQueryRequirements(query: string): {
    initialServices: Set<string>;
    entityResolutions: Map<string, Set<string>>;
  } {
    const initialServices = new Set<string>();
    const entityResolutions = new Map<string, Set<string>>();

    // For each service, check if it has resolvers for the query fields
    for (const [serviceName, service] of this.services) {
      const queryResolvers = service.getResolvers('Query');
      const mutationResolvers = service.getResolvers('Mutation');

      // Simple check: if service has any Query/Mutation resolvers, include it
      if (queryResolvers && queryResolvers.size > 0) {
        // Check if any resolver field matches query fields
        if (this.serviceHasRelevantResolvers(query, queryResolvers)) {
          initialServices.add(serviceName);
        }
      }

      if (mutationResolvers && mutationResolvers.size > 0) {
        if (this.serviceHasRelevantResolvers(query, mutationResolvers)) {
          initialServices.add(serviceName);
        }
      }
    }

    // If no specific services found, query all (fallback behavior)
    if (initialServices.size === 0) {
      for (const serviceName of this.services.keys()) {
        initialServices.add(serviceName);
      }
    }

    // Analyze for entity references that need cross-service resolution
    for (const [typeName, owningServices] of this.entityOwnership) {
      if (owningServices.size > 1) {
        // Entity is owned by multiple services - may need resolution
        entityResolutions.set(typeName, owningServices);
      }
    }

    return { initialServices, entityResolutions };
  }

  /**
   * Check if service has resolvers relevant to the query
   */
  private serviceHasRelevantResolvers(
    query: string,
    resolvers: Map<string, GraphQLResolver<unknown, GraphQLContext, Record<string, unknown>>>
  ): boolean {
    for (const fieldName of resolvers.keys()) {
      // Simple check: if field name appears in query
      if (query.includes(fieldName)) {
        return true;
      }
    }
    return false;
  }

  /**
   * Build an entity resolution query
   */
  private buildEntityResolutionQuery(typeName: string): string {
    return `
      query ResolveEntities($representations: [_Any!]!) {
        _entities(representations: $representations) {
          ... on ${typeName} {
            __typename
          }
        }
      }
    `;
  }

  /**
   * Group steps for parallel execution
   */
  private groupStepsForParallelExecution(steps: QueryPlanStep[]): QueryPlanStep[][] {
    const groups: QueryPlanStep[][] = [];
    const executed = new Set<string>();

    while (executed.size < steps.length) {
      const currentGroup: QueryPlanStep[] = [];

      for (const step of steps) {
        if (executed.has(step.id)) continue;

        // Check if all dependencies are executed
        const depsExecuted = step.dependencies.every((d) => executed.has(d));
        if (depsExecuted) {
          currentGroup.push(step);
        }
      }

      if (currentGroup.length === 0) {
        // Circular dependency or error
        this.logger?.warn({ steps, executed: Array.from(executed) }, 'Could not group remaining steps');
        break;
      }

      groups.push(currentGroup);
      currentGroup.forEach((s) => executed.add(s.id));
    }

    return groups;
  }

  /**
   * Estimate query cost
   */
  private estimateQueryCost(steps: QueryPlanStep[]): number {
    let cost = 0;

    for (const step of steps) {
      // Base cost per step
      cost += 10;

      // Additional cost for dependencies (indicates complexity)
      cost += step.dependencies.length * 5;

      // Entity resolution is more expensive
      if (step.entityReferences) {
        cost += 20;
      }
    }

    return cost;
  }

  /**
   * Execute a query plan
   */
  private async executePlan(
    plan: QueryPlan,
    variables?: Record<string, unknown>,
    context?: GraphQLContext
  ): Promise<ServiceExecutionResult[]> {
    const results: ServiceExecutionResult[] = [];
    const stepResults = new Map<string, ServiceExecutionResult>();

    // Execute groups in sequence, steps within groups in parallel
    for (const group of plan.parallelGroups) {
      const groupPromises = group.map(async (step) => {
        const service = this.services.get(step.service);
        if (!service) {
          return {
            service: step.service,
            error: new Error(`Service ${step.service} not found`),
            latency: 0,
          };
        }

        // Check service health
        const status = this.serviceStatus.get(step.service);
        if (status && !status.healthy) {
          return {
            service: step.service,
            error: new Error(`Service ${step.service} is unhealthy`),
            latency: 0,
          };
        }

        const startTime = Date.now();

        try {
          // For entity resolution steps, prepare representations
          let execVariables = variables;
          if (step.entityReferences && step.entityReferences.length > 0) {
            execVariables = {
              ...variables,
              representations: step.entityReferences,
            };
          }

          const result = await this.executeWithTimeout(
            service.execute(step.query, execVariables, context),
            this.config.timeout ?? 30000
          );

          return {
            service: step.service,
            result,
            latency: Date.now() - startTime,
          };
        } catch (error) {
          // Update error count
          if (status) {
            status.errorCount++;
          }

          return {
            service: step.service,
            error: error instanceof Error ? error : new Error(String(error)),
            latency: Date.now() - startTime,
          };
        }
      });

      const groupResults = await Promise.all(groupPromises);

      for (let i = 0; i < group.length; i++) {
        const step = group[i];
        const result = groupResults[i];
        if (step && result) {
          stepResults.set(step.id, result);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Execute with timeout
   */
  private async executeWithTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(Errors.timeout('Federation query', timeout)), timeout)
      ),
    ]);
  }

  /**
   * Merge results from multiple services
   */
  private mergeResults(results: ServiceExecutionResult[], plan: QueryPlan): GraphQLExecutionResult {
    const merged: GraphQLExecutionResult = {
      data: {},
      errors: [],
    };

    for (const { service, result, error } of results) {
      if (error) {
        merged.errors!.push({
          message: error.message,
          extensions: {
            code: 'SERVICE_ERROR',
            service,
          },
        });
        continue;
      }

      if (result?.data) {
        // Deep merge data
        merged.data = this.deepMerge(merged.data ?? {}, result.data);
      }

      if (result?.errors) {
        for (const err of result.errors) {
          merged.errors!.push({
            ...err,
            extensions: {
              ...err.extensions,
              service,
            },
          });
        }
      }
    }

    // Clean up empty arrays
    if (merged.errors?.length === 0) {
      delete merged.errors;
    }

    return merged;
  }

  /**
   * Deep merge two objects
   */
  private deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
    const result = { ...target };

    for (const [key, value] of Object.entries(source)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const targetValue = result[key];
        if (targetValue && typeof targetValue === 'object' && !Array.isArray(targetValue)) {
          result[key] = this.deepMerge(targetValue as Record<string, unknown>, value as Record<string, unknown>);
        } else {
          result[key] = value;
        }
      } else {
        result[key] = value;
      }
    }

    return result;
  }

  /**
   * Hash a query for caching
   */
  private hashQuery(query: string): string {
    // Simple hash function
    let hash = 0;
    const normalized = query.replace(/\s+/g, ' ').trim();

    for (let i = 0; i < normalized.length; i++) {
      const char = normalized.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }

    return `q${Math.abs(hash).toString(36)}`;
  }

  /**
   * Start health check polling
   */
  private startHealthChecks(): void {
    const interval = this.config.healthCheckInterval ?? 30000;

    this.healthCheckInterval = setInterval(() => {
      this.checkServiceHealth().catch((err) => {
        this.logger?.error({ error: err }, 'Health check failed');
      });
    }, interval);
  }

  /**
   * Check health of all services
   */
  private async checkServiceHealth(): Promise<void> {
    for (const [name, service] of this.services) {
      const status = this.serviceStatus.get(name)!;
      const startTime = Date.now();

      try {
        // Execute a simple introspection query
        await service.execute('{ __typename }');

        status.healthy = true;
        status.latency = Date.now() - startTime;
        status.lastCheck = Date.now();
        status.errorCount = 0;
      } catch {
        status.healthy = false;
        status.lastCheck = Date.now();
        this.emit('service:unhealthy', { name });
      }
    }
  }

  /**
   * Add a service to the federation
   */
  addService(config: GraphQLServiceConfig): void {
    const service = new GraphQLService(config, this.logger);
    this.services.set(config.name, service);

    this.serviceStatus.set(config.name, {
      name: config.name,
      url: config.url,
      healthy: true,
      lastCheck: Date.now(),
      errorCount: 0,
    });

    // Update entity ownership
    const entityTypes = service.getEntityTypes();
    for (const [typeName] of entityTypes) {
      if (!this.entityOwnership.has(typeName)) {
        this.entityOwnership.set(typeName, new Set());
      }
      this.entityOwnership.get(typeName)!.add(config.name);
    }

    // Rebuild schema
    this.buildFederatedSchema();

    // Clear query plan cache
    this.queryPlanCache.clear();

    this.emit('service:added', { name: config.name });
    this.logger?.info({ name: config.name }, 'Service added to federation');
  }

  /**
   * Remove a service from the federation
   */
  removeService(name: string): boolean {
    if (!this.services.delete(name)) {
      return false;
    }

    this.serviceStatus.delete(name);

    // Update entity ownership
    for (const [, owningServices] of this.entityOwnership) {
      owningServices.delete(name);
    }

    // Rebuild schema
    this.buildFederatedSchema();

    // Clear query plan cache
    this.queryPlanCache.clear();

    this.emit('service:removed', { name });
    this.logger?.info({ name }, 'Service removed from federation');

    return true;
  }

  /**
   * Get the federated schema
   */
  getSchema(): string {
    return this.federatedSchema;
  }

  /**
   * Get status of all services
   */
  getServiceStatus(): SubgraphStatus[] {
    return Array.from(this.serviceStatus.values());
  }

  /**
   * Get a specific service
   */
  getService(name: string): GraphQLService | undefined {
    return this.services.get(name);
  }

  /**
   * Resolve entities across services
   */
  async resolveEntities(
    representations: EntityRepresentation[],
    context: GraphQLContext
  ): Promise<(Record<string, unknown> | null)[]> {
    // Group representations by owning service
    const grouped = new Map<string, { indices: number[]; reps: EntityRepresentation[] }>();

    for (let i = 0; i < representations.length; i++) {
      const rep = representations[i];
      if (!rep) continue;

      const typename = rep.__typename;
      const owningServices = this.entityOwnership.get(typename);

      if (!owningServices || owningServices.size === 0) {
        continue;
      }

      // Use first owning service (could be smarter about selection)
      const serviceName = owningServices.values().next().value as string;

      if (!grouped.has(serviceName)) {
        grouped.set(serviceName, { indices: [], reps: [] });
      }

      const group = grouped.get(serviceName)!;
      group.indices.push(i);
      group.reps.push(rep);
    }

    // Resolve from each service
    const results: (Record<string, unknown> | null)[] = new Array(representations.length).fill(null);

    const resolvePromises = Array.from(grouped.entries()).map(async ([serviceName, { indices, reps }]) => {
      const service = this.services.get(serviceName);
      if (!service) return;

      const resolved = await service.resolveEntities(reps, context);

      for (let i = 0; i < indices.length; i++) {
        const idx = indices[i];
        const value = resolved[i];
        if (idx !== undefined && value !== undefined) {
          results[idx] = value;
        }
      }
    });

    await Promise.all(resolvePromises);

    return results;
  }

  /**
   * Shutdown the gateway
   */
  shutdown(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.queryPlanCache.clear();
    this.emit('shutdown');
    this.logger?.info('Federation gateway shutdown');
  }
}

// ============================================================================
// Federated Schema Builder
// ============================================================================

/**
 * Builds a federated schema from multiple service schemas
 */
class FederatedSchemaBuilder {
  private types = new Map<string, { schema: string; services: Set<string> }>();
  private queries = new Map<string, { field: string; service: string }>();
  private mutations = new Map<string, { field: string; service: string }>();
  private subscriptions = new Map<string, { field: string; service: string }>();

  /**
   * Add a service schema
   */
  addService(name: string, schema: string, types: Map<string, GraphQLTypeDefinition>): void {
    for (const [typeName, typeDef] of types) {
      if (!this.types.has(typeName)) {
        this.types.set(typeName, { schema: '', services: new Set() });
      }

      const entry = this.types.get(typeName)!;
      entry.services.add(name);

      // Track Query/Mutation/Subscription fields
      if (typeName === 'Query' && typeDef.fields) {
        for (const [fieldName] of typeDef.fields) {
          this.queries.set(fieldName, { field: fieldName, service: name });
        }
      } else if (typeName === 'Mutation' && typeDef.fields) {
        for (const [fieldName] of typeDef.fields) {
          this.mutations.set(fieldName, { field: fieldName, service: name });
        }
      } else if (typeName === 'Subscription' && typeDef.fields) {
        for (const [fieldName] of typeDef.fields) {
          this.subscriptions.set(fieldName, { field: fieldName, service: name });
        }
      }
    }
  }

  /**
   * Build the federated schema
   */
  build(): string {
    const parts: string[] = [];

    // Add federation directives
    parts.push(this.getFederationDirectives());

    // Build merged Query type
    if (this.queries.size > 0) {
      parts.push(this.buildRootType('Query', this.queries));
    }

    // Build merged Mutation type
    if (this.mutations.size > 0) {
      parts.push(this.buildRootType('Mutation', this.mutations));
    }

    // Build merged Subscription type
    if (this.subscriptions.size > 0) {
      parts.push(this.buildRootType('Subscription', this.subscriptions));
    }

    // Add _entities and _service fields for federation
    parts.push(`
extend type Query {
  _entities(representations: [_Any!]!): [_Entity]!
  _service: _Service!
}

scalar _Any

union _Entity = ${Array.from(this.types.keys()).filter((t) => !['Query', 'Mutation', 'Subscription'].includes(t)).join(' | ') || 'String'}

type _Service {
  sdl: String!
}
`);

    return parts.join('\n\n');
  }

  /**
   * Get federation directive definitions
   */
  private getFederationDirectives(): string {
    return `
directive @key(fields: String!) repeatable on OBJECT | INTERFACE
directive @external on FIELD_DEFINITION
directive @requires(fields: String!) on FIELD_DEFINITION
directive @provides(fields: String!) on FIELD_DEFINITION
directive @extends on OBJECT | INTERFACE
directive @shareable on OBJECT | FIELD_DEFINITION
directive @inaccessible on FIELD_DEFINITION | OBJECT | INTERFACE | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION
directive @override(from: String!) on FIELD_DEFINITION
directive @tag(name: String!) repeatable on FIELD_DEFINITION | INTERFACE | OBJECT | UNION | ARGUMENT_DEFINITION | SCALAR | ENUM | ENUM_VALUE | INPUT_OBJECT | INPUT_FIELD_DEFINITION
`;
  }

  /**
   * Build a root type (Query, Mutation, or Subscription)
   */
  private buildRootType(typeName: string, fields: Map<string, { field: string; service: string }>): string {
    const fieldDefs = Array.from(fields.entries())
      .map(([name, { service }]) => `  ${name}: String # from ${service}`)
      .join('\n');

    return `type ${typeName} {\n${fieldDefs}\n}`;
  }
}

// ============================================================================
// API Gateway Types
// ============================================================================

/**
 * HTTP method types
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'OPTIONS' | 'HEAD';

/**
 * API Service definition
 */
export interface APIService {
  name: string;
  prefix: string;
  upstream: string;
  routes: APIRouteDefinition[];
  timeout?: number;
  retries?: number;
}

/**
 * API Route definition
 */
export interface APIRouteDefinition {
  path: string;
  method: HttpMethod;
  auth?: boolean;
  cache?: boolean | CacheConfig;
  rateLimit?: RateLimitConfig;
  timeout?: number;
  transform?: {
    request?: (req: APIRequest) => APIRequest;
    response?: (res: APIResponse) => APIResponse;
  };
}

/**
 * Internal API Route (with resolved service info)
 */
interface APIRoute extends APIRouteDefinition {
  service?: string;
  upstream?: string;
}

/**
 * API Request
 */
export interface APIRequest {
  method: HttpMethod;
  path: string;
  headers?: Record<string, string>;
  body?: Record<string, unknown>;
  query?: Record<string, string>;
  params?: Record<string, string>;
  ip?: string;
  context?: GraphQLContext;
}

/**
 * API Response
 */
export interface APIResponse {
  status: number;
  body?: Record<string, unknown>;
  headers?: Record<string, string>;
}

/**
 * API Middleware function
 */
export type APIMiddleware = (request: APIRequest) => Promise<APIResponse | null>;

/**
 * Rate Limit Configuration
 */
export interface RateLimitConfig {
  requests: number;
  window: number; // milliseconds
  key?: 'ip' | 'user' | 'custom';
  keyExtractor?: (request: APIRequest) => string;
}

/**
 * Cache Configuration
 */
export interface CacheConfig {
  ttl: number; // milliseconds
  key?: (request: APIRequest) => string;
  invalidateOn?: HttpMethod[];
}

/**
 * CORS Configuration
 */
export interface CORSConfig {
  origin?: string | string[];
  methods?: string;
  headers?: string;
  credentials?: boolean;
  maxAge?: number;
}

/**
 * API Gateway Configuration
 */
export interface APIGatewayConfig {
  services: APIService[];
  rateLimit?: boolean | RateLimitConfig;
  cache?: boolean | CacheConfig;
  auth?: boolean | AuthConfig;
  cors?: CORSConfig;
  graphql?: GraphQLServiceConfig[];
  timeout?: number;
}

/**
 * Auth Configuration
 */
export interface AuthConfig {
  type: 'bearer' | 'basic' | 'apiKey' | 'custom';
  validator?: (token: string, request: APIRequest) => Promise<boolean>;
  excludePaths?: string[];
}

// ============================================================================
// API Gateway
// ============================================================================

/**
 * API Gateway
 *
 * Provides a unified API gateway with:
 * - Route matching and forwarding
 * - Rate limiting
 * - Caching
 * - Authentication
 * - CORS handling
 * - GraphQL federation integration
 */
export class APIGateway extends EventEmitter {
  private routes = new Map<string, APIRoute>();
  private middleware: APIMiddleware[] = [];
  private graphqlGateway?: GraphQLFederationGateway;
  private cache = new Map<string, { data: Record<string, unknown>; expiry: number }>();
  private rateLimitCounters = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly config: APIGatewayConfig,
    private readonly logger?: ILogger
  ) {
    super();
    this.initializeServices();
    this.setupMiddleware();

    if (config.graphql) {
      this.graphqlGateway = new GraphQLFederationGateway(
        { services: config.graphql },
        logger
      );
    }
  }

  /**
   * Initialize services and routes
   */
  private initializeServices(): void {
    for (const service of this.config.services) {
      for (const route of service.routes) {
        const fullPath = `${service.prefix}${route.path}`;
        this.routes.set(`${route.method}:${fullPath}`, {
          ...route,
          service: service.name,
          upstream: service.upstream,
        });
      }
    }

    this.logger?.info({ routeCount: this.routes.size }, 'API Gateway initialized');
  }

  /**
   * Setup middleware stack
   */
  private setupMiddleware(): void {
    // CORS should be first
    if (this.config.cors) {
      this.middleware.push(this.corsMiddleware());
    }

    // Auth before other middleware
    if (this.config.auth) {
      this.middleware.push(this.authMiddleware());
    }

    // Rate limiting
    if (this.config.rateLimit) {
      this.middleware.push(this.rateLimitMiddleware());
    }

    // Caching
    if (this.config.cache) {
      this.middleware.push(this.cacheMiddleware());
    }
  }

  /**
   * Add custom middleware
   */
  use(middleware: APIMiddleware): void {
    this.middleware.push(middleware);
  }

  /**
   * Handle incoming request
   */
  async handleRequest(request: APIRequest): Promise<APIResponse> {
    const startTime = Date.now();

    try {
      // Apply middleware
      for (const mw of this.middleware) {
        const result = await mw(request);
        if (result) {
          this.emit('request:middleware', { path: request.path, status: result.status });
          return result;
        }
      }

      // Handle GraphQL requests
      if (request.path === '/graphql' && this.graphqlGateway) {
        return await this.handleGraphQLRequest(request);
      }

      // Route to service
      const route = this.findRoute(request.path, request.method);
      if (!route) {
        return {
          status: 404,
          body: { error: 'Route not found', path: request.path },
        };
      }

      const response = await this.forwardRequest(request, route);

      // Update cache if needed (from route config or global config)
      const cacheConfig = route.cache ?? this.config.cache;
      if (cacheConfig && request.method === 'GET' && response.status === 200) {
        this.cacheResponse(request, response, cacheConfig);
      }

      const latency = Date.now() - startTime;
      this.emit('request:completed', {
        path: request.path,
        method: request.method,
        status: response.status,
        latency,
      });

      return response;
    } catch (error) {
      this.logger?.error({ error, path: request.path }, 'Request handling failed');

      return {
        status: 500,
        body: { error: 'Internal server error' },
      };
    }
  }

  /**
   * Handle GraphQL request
   */
  private async handleGraphQLRequest(request: APIRequest): Promise<APIResponse> {
    if (!this.graphqlGateway) {
      return {
        status: 500,
        body: { error: 'GraphQL not configured' },
      };
    }

    try {
      const body = request.body;
      const query = body?.['query'];
      if (!body || typeof query !== 'string') {
        return {
          status: 400,
          body: { error: 'Invalid GraphQL request: query is required' },
        };
      }

      const variables = body['variables'] as Record<string, unknown> | undefined;
      const result = await this.graphqlGateway.execute(
        query,
        variables,
        request.context
      );

      return {
        status: result.errors ? 200 : 200, // GraphQL always returns 200 even with errors
        body: result as unknown as Record<string, unknown>,
        headers: { 'Content-Type': 'application/json' },
      };
    } catch (error) {
      return {
        status: 500,
        body: {
          errors: [{ message: error instanceof Error ? error.message : String(error) }],
        },
      };
    }
  }

  /**
   * Find matching route
   */
  private findRoute(path: string, method: HttpMethod): APIRoute | undefined {
    // Try exact match first
    const exactKey = `${method}:${path}`;
    if (this.routes.has(exactKey)) {
      return this.routes.get(exactKey);
    }

    // Try pattern matching
    for (const [pattern, route] of this.routes) {
      // Split only on the first colon to separate method from path
      const colonIndex = pattern.indexOf(':');
      if (colonIndex === -1) continue;

      const routeMethod = pattern.slice(0, colonIndex);
      const routePath = pattern.slice(colonIndex + 1);

      if (routeMethod !== method) continue;

      if (routePath && this.matchPath(path, routePath)) {
        return route;
      }
    }

    return undefined;
  }

  /**
   * Match path against pattern with parameter support
   */
  private matchPath(path: string, pattern: string): boolean {
    // Convert pattern to regex (e.g., /users/:id -> /users/([^/]+))
    const regexPattern = pattern.replace(/:[^/]+/g, '([^/]+)');
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(path);
  }

  /**
   * Extract path parameters
   */
  private extractParams(path: string, pattern: string): Record<string, string> {
    const params: Record<string, string> = {};
    const patternParts = pattern.split('/');
    const pathParts = path.split('/');

    for (let i = 0; i < patternParts.length; i++) {
      const patternPart = patternParts[i];
      const pathPart = pathParts[i];

      if (patternPart?.startsWith(':') && pathPart) {
        params[patternPart.slice(1)] = pathPart;
      }
    }

    return params;
  }

  /**
   * Forward request to upstream service
   */
  private async forwardRequest(request: APIRequest, route: APIRoute): Promise<APIResponse> {
    this.emit('request:forwarding', {
      service: route.service,
      upstream: route.upstream,
      path: request.path,
    });

    // In production, would make actual HTTP request to upstream
    // For now, simulate successful forwarding
    return {
      status: 200,
      body: {
        message: 'Request forwarded',
        service: route.service,
        upstream: route.upstream,
        path: request.path,
      },
    };
  }

  /**
   * Auth middleware
   */
  private authMiddleware(): APIMiddleware {
    const authConfig = typeof this.config.auth === 'object' ? this.config.auth : undefined;
    const excludePaths = authConfig?.excludePaths ?? [];

    return async (request: APIRequest) => {
      // Skip auth for excluded paths
      if (excludePaths.some((p) => request.path.startsWith(p))) {
        return null;
      }

      const authHeader = request.headers?.['authorization'];

      if (!authHeader) {
        return {
          status: 401,
          body: { error: 'Unauthorized', message: 'Authorization header required' },
        };
      }

      // Custom validator
      if (authConfig?.validator) {
        const token = authHeader.replace(/^Bearer\s+/i, '');
        const isValid = await authConfig.validator(token, request);

        if (!isValid) {
          return {
            status: 401,
            body: { error: 'Unauthorized', message: 'Invalid token' },
          };
        }
      }

      return null;
    };
  }

  /**
   * Rate limit middleware
   */
  private rateLimitMiddleware(): APIMiddleware {
    const config: RateLimitConfig =
      typeof this.config.rateLimit === 'object'
        ? this.config.rateLimit
        : { requests: 100, window: 60000 };

    return async (request: APIRequest) => {
      const key = config.keyExtractor
        ? config.keyExtractor(request)
        : request.ip ?? 'anonymous';

      const now = Date.now();
      let counter = this.rateLimitCounters.get(key);

      // Reset if window expired
      if (!counter || now >= counter.resetAt) {
        counter = { count: 0, resetAt: now + config.window };
        this.rateLimitCounters.set(key, counter);
      }

      counter.count++;

      if (counter.count > config.requests) {
        const retryAfter = Math.ceil((counter.resetAt - now) / 1000);

        return {
          status: 429,
          body: { error: 'Too many requests', retryAfter },
          headers: { 'Retry-After': String(retryAfter) },
        };
      }

      return null;
    };
  }

  /**
   * Cache middleware
   */
  private cacheMiddleware(): APIMiddleware {
    return async (request: APIRequest) => {
      if (request.method !== 'GET') return null;

      const cacheKey = `${request.method}:${request.path}`;
      const cached = this.cache.get(cacheKey);

      if (cached && cached.expiry > Date.now()) {
        return {
          status: 200,
          body: cached.data,
          headers: { 'X-Cache': 'HIT' },
        };
      }

      // Cache miss or expired - will be cached after response
      return null;
    };
  }

  /**
   * Cache a response
   */
  private cacheResponse(request: APIRequest, response: APIResponse, config: boolean | CacheConfig): void {
    const cacheConfig: CacheConfig =
      typeof config === 'object' ? config : { ttl: 60000 };

    const cacheKey = cacheConfig.key
      ? cacheConfig.key(request)
      : `${request.method}:${request.path}`;

    if (response.body) {
      this.cache.set(cacheKey, {
        data: response.body,
        expiry: Date.now() + cacheConfig.ttl,
      });
    }
  }

  /**
   * CORS middleware
   */
  private corsMiddleware(): APIMiddleware {
    const cors = this.config.cors!;

    return async (request: APIRequest) => {
      // Handle preflight
      if (request.method === 'OPTIONS') {
        const origin = Array.isArray(cors.origin) ? cors.origin[0] : cors.origin;

        return {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': origin ?? '*',
            'Access-Control-Allow-Methods': cors.methods ?? 'GET,POST,PUT,DELETE,PATCH,OPTIONS',
            'Access-Control-Allow-Headers': cors.headers ?? 'Content-Type,Authorization',
            'Access-Control-Max-Age': String(cors.maxAge ?? 86400),
            ...(cors.credentials && { 'Access-Control-Allow-Credentials': 'true' }),
          },
        };
      }

      return null;
    };
  }

  /**
   * Clear cache
   */
  clearCache(pattern?: string): void {
    if (pattern) {
      for (const key of this.cache.keys()) {
        if (key.includes(pattern)) {
          this.cache.delete(key);
        }
      }
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get the GraphQL gateway
   */
  getGraphQLGateway(): GraphQLFederationGateway | undefined {
    return this.graphqlGateway;
  }

  /**
   * Shutdown the gateway
   */
  shutdown(): void {
    this.graphqlGateway?.shutdown();
    this.cache.clear();
    this.rateLimitCounters.clear();
    this.emit('shutdown');
  }
}

// ============================================================================
// GraphQL Decorators
// ============================================================================

/**
 * Decorator target type
 */
type DecoratorTarget = { constructor: Function };

/**
 * GraphQL Service decorator
 * Marks a class as a GraphQL service with the given configuration
 */
export function GraphQLServiceDecorator(config: GraphQLServiceConfig): ClassDecorator {
  return function (target: Function): void {
    Reflect.defineMetadata('graphql:service', config, target);
  };
}

/**
 * Query decorator
 * Marks a method as a GraphQL query resolver
 */
export function Query(name?: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const resolverName = name ?? String(propertyKey);
    Reflect.defineMetadata('graphql:query', resolverName, target, propertyKey);
  };
}

/**
 * Mutation decorator
 * Marks a method as a GraphQL mutation resolver
 */
export function Mutation(name?: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const resolverName = name ?? String(propertyKey);
    Reflect.defineMetadata('graphql:mutation', resolverName, target, propertyKey);
  };
}

/**
 * Subscription decorator
 * Marks a method as a GraphQL subscription resolver
 */
export function Subscription(name?: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const resolverName = name ?? String(propertyKey);
    Reflect.defineMetadata('graphql:subscription', resolverName, target, propertyKey);
  };
}

/**
 * FieldResolver decorator
 * Marks a method as a field resolver for a specific type
 */
export function FieldResolver(typeName: string, fieldName: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    Reflect.defineMetadata('graphql:field', { typeName, fieldName }, target, propertyKey);
  };
}

/**
 * Key directive decorator
 * Marks a type as an entity with the specified key fields
 */
export function Key(fields: string): ClassDecorator {
  return function (target: Function): void {
    const existing = Reflect.getMetadata('graphql:directives', target) ?? [];
    existing.push({ type: 'key', fields });
    Reflect.defineMetadata('graphql:directives', existing, target);
  };
}

/**
 * Requires directive decorator
 * Specifies fields required from other services
 */
export function Requires(fields: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const existing = Reflect.getMetadata('graphql:requires', target, propertyKey) ?? [];
    existing.push(fields);
    Reflect.defineMetadata('graphql:requires', existing, target, propertyKey);
  };
}

/**
 * Provides directive decorator
 * Specifies fields this resolver provides
 */
export function Provides(fields: string): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    const existing = Reflect.getMetadata('graphql:provides', target, propertyKey) ?? [];
    existing.push(fields);
    Reflect.defineMetadata('graphql:provides', existing, target, propertyKey);
  };
}

/**
 * External directive decorator
 * Marks a field as external (defined in another service)
 */
export function External(): MethodDecorator {
  return function (
    target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor
  ): void {
    Reflect.defineMetadata('graphql:external', true, target, propertyKey);
  };
}

/**
 * Extends directive decorator
 * Marks a type as extending a type from another service
 */
export function Extends(): ClassDecorator {
  return function (target: Function): void {
    Reflect.defineMetadata('graphql:extends', true, target);
  };
}
