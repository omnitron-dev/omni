/**
 * Tests for InjectionToken
 */

import { describe, it, expect } from 'vitest';
import { InjectionToken, createInjectionToken } from '../../../src/di/tokens.js';

describe('InjectionToken', () => {
  describe('Constructor', () => {
    it('should create token with description', () => {
      const token = new InjectionToken<string>('API_URL');
      expect(token._desc).toBe('API_URL');
    });

    it('should have toString method', () => {
      const token = new InjectionToken<string>('API_URL');
      expect(token.toString()).toBe('InjectionToken(API_URL)');
    });

    it('should support generic types', () => {
      const stringToken = new InjectionToken<string>('STRING');
      const numberToken = new InjectionToken<number>('NUMBER');
      const objectToken = new InjectionToken<{ foo: string }>('OBJECT');

      expect(stringToken).toBeDefined();
      expect(numberToken).toBeDefined();
      expect(objectToken).toBeDefined();
    });
  });

  describe('createInjectionToken', () => {
    it('should create token using helper function', () => {
      const token = createInjectionToken<string>('API_URL');
      expect(token).toBeInstanceOf(InjectionToken);
      expect(token._desc).toBe('API_URL');
    });

    it('should create unique tokens', () => {
      const token1 = createInjectionToken<string>('TOKEN');
      const token2 = createInjectionToken<string>('TOKEN');

      expect(token1).not.toBe(token2);
    });
  });

  describe('Token identity', () => {
    it('should be referentially unique', () => {
      const token1 = new InjectionToken<string>('API');
      const token2 = new InjectionToken<string>('API');

      expect(token1 === token2).toBe(false);
    });

    it('should maintain identity when assigned', () => {
      const token = new InjectionToken<string>('API');
      const sameToken = token;

      expect(token === sameToken).toBe(true);
    });
  });
});
