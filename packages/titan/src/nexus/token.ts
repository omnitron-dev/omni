/**
 * Token system for type-safe dependency identification
 */

import { Token, Scope, MultiToken, TokenMetadata } from './types.js';
import { Errors } from '../errors/factories.js';

/**
 * Token registry for caching tokens by name
 */
const tokenRegistry = new Map<string, EnhancedToken<any>>();

/**
 * Base token interface with enhanced features
 */
export interface EnhancedToken<T = any> extends Token<T> {
  readonly symbol: symbol;
  readonly isMulti: boolean;
  readonly isOptional: boolean;
  readonly isConfig?: boolean;
  readonly parent?: Token<any>;
  equals(other: Token): boolean;
  withMetadata(metadata: Partial<TokenMetadata>): Token<T>;
  toJSON(): any;
}

/**
 * Enhanced multi-token interface
 */
export interface EnhancedMultiToken<T = any> extends MultiToken<T>, EnhancedToken<T> {
  readonly multi: true;
  readonly isMulti: true;
}

/**
 * Enhanced optional token interface
 */
export interface EnhancedOptionalToken<T = any> extends EnhancedToken<T | undefined> {
  readonly isOptional: true;
}

/**
 * Config token with validation
 */
export interface ConfigToken<T = any> extends EnhancedToken<T> {
  readonly isConfig: true;
  readonly validate?: (config: T) => boolean;
  readonly defaults?: Partial<T>;
}

/**
 * Lazy token for lazy loading
 */
export interface LazyToken<T = any> extends EnhancedToken<T> {
  readonly isLazy: true;
}

/**
 * Creates a type-safe token for dependency identification
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed token
 */
export function createToken<T = any>(name: string, metadata: Partial<TokenMetadata> = {}): EnhancedToken<T> {
  if (!name || (typeof name === 'string' && name.trim() === '')) {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  // Create a registry key based on name only for consistent token identity
  // Tokens with the same name should be the same token instance
  const registryKey = name;

  // Check if token already exists in registry
  // Only reuse if no metadata is provided (for backward compatibility)
  if (tokenRegistry.has(registryKey) && Object.keys(metadata).length === 0) {
    return tokenRegistry.get(registryKey) as EnhancedToken<T>;
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:token:${name}`);

  const token: EnhancedToken<T> = {
    id,
    symbol,
    name,
    metadata,
    type: undefined as any as T,
    isMulti: false,
    isOptional: false,
    parent: (metadata as any).parent,
    toString() {
      return `[Token: ${name}]`;
    },
    equals(other: Token) {
      return other ? this.symbol === (other as any).symbol : false;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      const { name: metadataName, ...cleanMetadata } = token.metadata;
      return {
        name: token.name,
        type: 'Token',
        metadata: cleanMetadata,
      };
    },
  };

  // Cache the token only if it has no metadata (to avoid conflicts)
  if (Object.keys(metadata).length === 0) {
    tokenRegistry.set(registryKey, token);
  }

  return token;
}

/**
 * Creates a multi-token for registering multiple providers
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed multi-token
 */
export function createMultiToken<T = any>(name?: string, metadata: Partial<TokenMetadata> = {}): EnhancedMultiToken<T> {
  const tokenName = name || `MultiToken_${Math.random().toString(36).substr(2, 9)}`;

  if (!tokenName || tokenName.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name: tokenName });
  }

  const symbol = Symbol(tokenName);
  const id = Symbol.for(`nexus:multi-token:${tokenName}`);

  const token: EnhancedMultiToken<T> = {
    id,
    symbol,
    name: tokenName,
    multi: true as const,
    isMulti: true,
    isOptional: false,
    metadata: {
      name: tokenName,
      multi: true,
      ...metadata,
    },
    type: undefined as any as T,
    toString() {
      return `[MultiToken: ${tokenName}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'MultiToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates an optional token that won't throw if not found
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed optional token
 */
export function createOptionalToken<T = any>(
  name: string,
  metadata: Partial<TokenMetadata> = {}
): EnhancedOptionalToken<T> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:optional-token:${name}`);

  const token: EnhancedOptionalToken<T> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      optional: true,
      ...metadata,
    },
    type: undefined as any as T | undefined,
    isMulti: false,
    isOptional: true,
    toString() {
      return `[OptionalToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'OptionalToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates a config token with validation and default values
 * @param name - The name of the token
 * @param options - Config options
 * @returns A typed config token
 */
export function createConfigToken<T = any>(
  name: string,
  options: {
    validate?: (config: T) => boolean;
    defaults?: Partial<T>;
  } = {}
): ConfigToken<T> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:config-token:${name}`);

  const token: ConfigToken<T> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      tags: ['config'],
    },
    type: undefined as any as T,
    isMulti: false,
    isOptional: false,
    isConfig: true,
    validate: options.validate,
    defaults: options.defaults,
    toString() {
      return `[ConfigToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'ConfigToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates a lazy token for lazy loading
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed lazy token
 */
export function createLazyToken<T = any>(name: string, metadata: Partial<TokenMetadata> = {}): LazyToken<T> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:lazy-token:${name}`);

  const token: LazyToken<T> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      tags: ['lazy', ...(metadata.tags || [])],
      ...metadata,
    },
    type: undefined as any as T,
    isMulti: false,
    isOptional: false,
    isLazy: true,
    toString() {
      return `[LazyToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'LazyToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates a scoped token with specific lifecycle
 * @param name - The name of the token
 * @param scope - The lifecycle scope
 * @param metadata - Optional metadata for the token
 * @returns A typed scoped token
 */
export function createScopedToken<T = any>(
  name: string,
  scope: Scope,
  metadata: Partial<TokenMetadata> = {}
): EnhancedToken<T> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(`${name}:${scope}`);
  const id = Symbol.for(`nexus:scoped-token:${name}:${scope}`);

  const token: EnhancedToken<T> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      scope,
      ...metadata,
    },
    type: undefined as any as T,
    isMulti: false,
    isOptional: false,
    toString() {
      return `[ScopedToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'ScopedToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates an async token for asynchronous dependencies
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed async token
 */
export function createAsyncToken<T = any>(name: string, metadata: Partial<TokenMetadata> = {}): EnhancedToken<T> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:async-token:${name}`);

  const token: EnhancedToken<T> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      tags: ['async', ...(metadata.tags || [])],
      ...metadata,
    },
    type: undefined as any as T,
    isMulti: false,
    isOptional: false,
    toString() {
      return `[AsyncToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'AsyncToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Creates a stream token for streaming dependencies
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed stream token
 */
export function createStreamToken<T = any>(
  name: string,
  metadata: Partial<TokenMetadata> = {}
): EnhancedToken<AsyncIterable<T>> {
  if (!name || name.trim() === '') {
    throw Errors.badRequest('Token name cannot be empty', { name });
  }

  const symbol = Symbol(name);
  const id = Symbol.for(`nexus:stream-token:${name}`);

  const token: EnhancedToken<AsyncIterable<T>> = {
    id,
    symbol,
    name,
    metadata: {
      name,
      tags: ['stream', 'async', ...(metadata.tags || [])],
      ...metadata,
    },
    type: undefined as any as AsyncIterable<T>,
    isMulti: false,
    isOptional: false,
    toString() {
      return `[StreamToken: ${name}]`;
    },
    equals(other: Token) {
      return this.symbol === (other as any).symbol;
    },
    withMetadata(newMetadata: Partial<TokenMetadata>) {
      return {
        ...token,
        metadata: {
          ...token.metadata,
          ...newMetadata,
        },
      };
    },
    toJSON() {
      return {
        name: token.name,
        type: 'StreamToken',
        metadata: token.metadata,
      };
    },
  };

  return token;
}

/**
 * Checks if a value is a Token
 * @param value - The value to check
 * @returns True if the value is a Token
 */
export function isToken(value: any): value is Token {
  return (
    !!value &&
    typeof value === 'object' &&
    'id' in value &&
    typeof value.id === 'symbol' &&
    'name' in value &&
    'metadata' in value
  );
}

/**
 * Checks if a token is a MultiToken
 * @param token - The token to check
 * @returns True if the token is a MultiToken
 */
export function isMultiToken(token: any): token is MultiToken {
  return (
    isToken(token) && (('multi' in token && token.multi === true) || ('isMulti' in token && token.isMulti === true))
  );
}

/**
 * Checks if a token is optional
 * @param token - The token to check
 * @returns True if the token is optional
 */
export function isOptionalToken(token: Token): boolean {
  if (typeof token === 'string' || typeof token === 'symbol') {
    return false;
  }
  return token.metadata?.optional === true || ('isOptional' in token && (token as any).isOptional === true);
}

/**
 * Gets the display name for a token or identifier
 * @param identifier - The token or identifier
 * @returns A string representation
 */
export function getTokenName(identifier: any): string {
  if (isToken(identifier)) {
    return identifier.name;
  }
  if (typeof identifier === 'string') {
    return identifier;
  }
  if (typeof identifier === 'symbol') {
    return identifier.toString();
  }
  if (typeof identifier === 'function' && identifier.name) {
    return identifier.name;
  }
  return 'Unknown';
}

/**
 * Creates a token from a class constructor
 * @param constructor - The class constructor
 * @param metadata - Optional metadata for the token
 * @returns A typed token
 */
export function tokenFromClass<T>(
  constructor: new (...args: any[]) => T,
  metadata: Partial<TokenMetadata> = {}
): EnhancedToken<T> {
  return createToken<T>(constructor.name, metadata);
}

/**
 * Token registry for global token management
 */
export class TokenRegistry {
  private static instance: TokenRegistry;
  private tokens = new Map<symbol, Token>();

  private constructor() {}

  static getInstance(): TokenRegistry {
    if (!TokenRegistry.instance) {
      TokenRegistry.instance = new TokenRegistry();
    }
    return TokenRegistry.instance;
  }

  /**
   * Register a token globally
   */
  register(token: Token): void {
    this.tokens.set(token.id, token);
  }

  /**
   * Get a token by its ID
   */
  get(id: symbol): Token | undefined {
    return this.tokens.get(id);
  }

  /**
   * Get a token by its name
   */
  getByName(name: string): Token | undefined {
    for (const token of this.tokens.values()) {
      if (token.name === name) {
        return token;
      }
    }
    return undefined;
  }

  /**
   * Get all registered tokens
   */
  getAll(): Token[] {
    return Array.from(this.tokens.values());
  }

  /**
   * Clear all registered tokens
   */
  clear(): void {
    this.tokens.clear();
  }
}
