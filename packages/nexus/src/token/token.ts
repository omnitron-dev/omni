/**
 * Token system for type-safe dependency identification
 */

import { Token, MultiToken, TokenMetadata, Scope } from '../types/core';

/**
 * Creates a type-safe token for dependency identification
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed token
 */
export function createToken<T = any>(
  name: string,
  metadata: Partial<TokenMetadata> = {}
): Token<T> {
  const id = Symbol.for(`nexus:token:${name}`);
  
  return {
    id,
    name,
    metadata: {
      name,
      ...metadata
    },
    type: undefined as any as T
  };
}

/**
 * Creates a multi-token for registering multiple providers
 * @param name - The name of the token
 * @param metadata - Optional metadata for the token
 * @returns A typed multi-token
 */
export function createMultiToken<T = any>(
  name: string,
  metadata: Partial<TokenMetadata> = {}
): MultiToken<T> {
  const id = Symbol.for(`nexus:multi-token:${name}`);
  
  return {
    id,
    name,
    multi: true,
    metadata: {
      name,
      multi: true,
      ...metadata
    },
    type: undefined as any as T
  };
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
): Token<T | undefined> {
  const id = Symbol.for(`nexus:optional-token:${name}`);
  
  return {
    id,
    name,
    metadata: {
      name,
      optional: true,
      ...metadata
    },
    type: undefined as any as T | undefined
  };
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
): Token<T> {
  const id = Symbol.for(`nexus:scoped-token:${name}:${scope}`);
  
  return {
    id,
    name,
    metadata: {
      name,
      scope,
      ...metadata
    },
    type: undefined as any as T
  };
}

/**
 * Checks if a value is a Token
 * @param value - The value to check
 * @returns True if the value is a Token
 */
export function isToken(value: any): value is Token {
  return !!value && 
    typeof value === 'object' && 
    'id' in value && 
    typeof value.id === 'symbol' &&
    'name' in value &&
    'metadata' in value;
}

/**
 * Checks if a token is a MultiToken
 * @param token - The token to check
 * @returns True if the token is a MultiToken
 */
export function isMultiToken(token: any): token is MultiToken {
  return isToken(token) && 'multi' in token && token.multi === true;
}

/**
 * Checks if a token is optional
 * @param token - The token to check
 * @returns True if the token is optional
 */
export function isOptionalToken(token: Token): boolean {
  return token.metadata.optional === true;
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
): Token<T> {
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