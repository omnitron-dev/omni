/**
 * Tests for Nexus Token System
 */

import {
  createToken,
  createMultiToken,
  createOptionalToken,
  createScopedToken,
  isToken,
  isMultiToken,
  isOptionalToken,
  getTokenName,
  tokenFromClass,
  TokenRegistry,
  Scope
} from '../src';

describe('Token System', () => {
  describe('createToken', () => {
    it('should create a basic token', () => {
      const token = createToken<string>('TestToken');
      
      expect(token.name).toBe('TestToken');
      expect(token.id).toBeDefined();
      expect(typeof token.id).toBe('symbol');
      expect(token.metadata.name).toBe('TestToken');
    });

    it('should create tokens with metadata', () => {
      const token = createToken<number>('NumberToken', {
        description: 'A number token',
        tags: ['test', 'number'],
        scope: Scope.Singleton
      });
      
      expect(token.metadata.description).toBe('A number token');
      expect(token.metadata.tags).toEqual(['test', 'number']);
      expect(token.metadata.scope).toBe(Scope.Singleton);
    });

    it('should create unique symbols for different tokens', () => {
      const token1 = createToken('Token1');
      const token2 = createToken('Token2');
      
      expect(token1.id).not.toBe(token2.id);
    });

    it('should use Symbol.for for consistent symbols', () => {
      const token1 = createToken('SameToken');
      const token2 = createToken('SameToken');
      
      expect(token1.id).toBe(token2.id);
    });
  });

  describe('createMultiToken', () => {
    it('should create a multi-token', () => {
      const token = createMultiToken<string>('MultiToken');
      
      expect(token.name).toBe('MultiToken');
      expect(token.multi).toBe(true);
      expect(token.metadata.multi).toBe(true);
    });

    it('should be identifiable as multi-token', () => {
      const regular = createToken('Regular');
      const multi = createMultiToken('Multi');
      
      expect(isMultiToken(regular)).toBe(false);
      expect(isMultiToken(multi)).toBe(true);
    });
  });

  describe('createOptionalToken', () => {
    it('should create an optional token', () => {
      const token = createOptionalToken<string>('OptionalToken');
      
      expect(token.name).toBe('OptionalToken');
      expect(token.metadata.optional).toBe(true);
    });

    it('should be identifiable as optional', () => {
      const regular = createToken('Regular');
      const optional = createOptionalToken('Optional');
      
      expect(isOptionalToken(regular)).toBe(false);
      expect(isOptionalToken(optional)).toBe(true);
    });
  });

  describe('createScopedToken', () => {
    it('should create a scoped token', () => {
      const token = createScopedToken('ScopedToken', Scope.Singleton);
      
      expect(token.name).toBe('ScopedToken');
      expect(token.metadata.scope).toBe(Scope.Singleton);
    });

    it('should include scope in symbol name', () => {
      const singleton = createScopedToken('Token', Scope.Singleton);
      const transient = createScopedToken('Token', Scope.Transient);
      
      expect(singleton.id).not.toBe(transient.id);
    });
  });

  describe('Token type guards', () => {
    it('should identify tokens', () => {
      const token = createToken('Test');
      const notToken = { name: 'Test' };
      
      expect(isToken(token)).toBe(true);
      expect(isToken(notToken)).toBe(false);
      expect(isToken(null)).toBe(false);
      expect(isToken(undefined)).toBe(false);
      expect(isToken('string')).toBe(false);
    });

    it('should identify multi-tokens', () => {
      const multi = createMultiToken('Multi');
      const regular = createToken('Regular');
      
      expect(isMultiToken(multi)).toBe(true);
      expect(isMultiToken(regular)).toBe(false);
    });

    it('should identify optional tokens', () => {
      const optional = createOptionalToken('Optional');
      const regular = createToken('Regular');
      
      expect(isOptionalToken(optional)).toBe(true);
      expect(isOptionalToken(regular)).toBe(false);
    });
  });

  describe('getTokenName', () => {
    it('should get name from token', () => {
      const token = createToken('TestToken');
      expect(getTokenName(token)).toBe('TestToken');
    });

    it('should get name from string', () => {
      expect(getTokenName('StringToken')).toBe('StringToken');
    });

    it('should get name from symbol', () => {
      const sym = Symbol('SymbolToken');
      expect(getTokenName(sym)).toBe('Symbol(SymbolToken)');
    });

    it('should get name from class', () => {
      class TestClass {}
      expect(getTokenName(TestClass)).toBe('TestClass');
    });

    it('should return Unknown for invalid input', () => {
      expect(getTokenName(null)).toBe('Unknown');
      expect(getTokenName(undefined)).toBe('Unknown');
      expect(getTokenName({})).toBe('Unknown');
    });
  });

  describe('tokenFromClass', () => {
    it('should create token from class constructor', () => {
      class UserService {}
      
      const token = tokenFromClass(UserService);
      
      expect(token.name).toBe('UserService');
      expect(token.metadata.name).toBe('UserService');
    });

    it('should include metadata', () => {
      class DatabaseService {}
      
      const token = tokenFromClass(DatabaseService, {
        scope: Scope.Singleton,
        description: 'Database service'
      });
      
      expect(token.metadata.scope).toBe(Scope.Singleton);
      expect(token.metadata.description).toBe('Database service');
    });
  });

  describe('TokenRegistry', () => {
    let registry: TokenRegistry;

    beforeEach(() => {
      registry = TokenRegistry.getInstance();
      registry.clear();
    });

    it('should be a singleton', () => {
      const registry1 = TokenRegistry.getInstance();
      const registry2 = TokenRegistry.getInstance();
      
      expect(registry1).toBe(registry2);
    });

    it('should register and retrieve tokens', () => {
      const token = createToken('TestToken');
      
      registry.register(token);
      
      expect(registry.get(token.id)).toBe(token);
    });

    it('should get token by name', () => {
      const token = createToken('NamedToken');
      
      registry.register(token);
      
      expect(registry.getByName('NamedToken')).toBe(token);
      expect(registry.getByName('NonExistent')).toBeUndefined();
    });

    it('should get all registered tokens', () => {
      const token1 = createToken('Token1');
      const token2 = createToken('Token2');
      const token3 = createToken('Token3');
      
      registry.register(token1);
      registry.register(token2);
      registry.register(token3);
      
      const all = registry.getAll();
      
      expect(all).toHaveLength(3);
      expect(all).toContain(token1);
      expect(all).toContain(token2);
      expect(all).toContain(token3);
    });

    it('should clear all tokens', () => {
      const token = createToken('ToClear');
      
      registry.register(token);
      expect(registry.getAll()).toHaveLength(1);
      
      registry.clear();
      expect(registry.getAll()).toHaveLength(0);
      expect(registry.get(token.id)).toBeUndefined();
    });
  });

  describe('Token equality and comparison', () => {
    it('should maintain referential equality for same token name', () => {
      const token1 = createToken('SameName');
      const token2 = createToken('SameName');
      
      // Same symbol due to Symbol.for
      expect(token1.id).toBe(token2.id);
      
      // Different object references
      expect(token1).not.toBe(token2);
      
      // But functionally equivalent
      expect(token1.name).toBe(token2.name);
    });

    it('should differentiate tokens by type', () => {
      const regular = createToken('Token');
      const multi = createMultiToken('Token');
      const optional = createOptionalToken('Token');
      
      // All have different symbols
      expect(regular.id).not.toBe(multi.id);
      expect(regular.id).not.toBe(optional.id);
      expect(multi.id).not.toBe(optional.id);
    });

    it('should differentiate scoped tokens', () => {
      const singleton = createScopedToken('Token', Scope.Singleton);
      const transient = createScopedToken('Token', Scope.Transient);
      const scoped = createScopedToken('Token', Scope.Scoped);
      
      expect(singleton.id).not.toBe(transient.id);
      expect(singleton.id).not.toBe(scoped.id);
      expect(transient.id).not.toBe(scoped.id);
    });
  });

  describe('Type inference', () => {
    it('should maintain type information', () => {
      interface UserService {
        getUser(id: string): { name: string };
      }
      
      const token = createToken<UserService>('UserService');
      
      // TypeScript should infer the correct type
      // This is a compile-time check, but we can verify the token structure
      expect(token.name).toBe('UserService');
      expect(token.type).toBeUndefined(); // Type is phantom, not runtime
    });

    it('should work with complex types', () => {
      type ComplexType = {
        method1: (a: string, b: number) => Promise<void>;
        method2: () => { nested: { value: string } };
        property: string[];
      };
      
      const token = createToken<ComplexType>('ComplexToken');
      
      expect(token.name).toBe('ComplexToken');
    });
  });
});