/**
 * Tests for Injectable decorator and function
 */

import 'reflect-metadata';
import { describe, it, expect } from 'vitest';
import { Injectable, injectable, isInjectable, getInjectableOptions } from '../../../src/di/injectable.js';

describe('Injectable', () => {
  describe('@Injectable decorator', () => {
    it('should mark class as injectable', () => {
      @Injectable()
      class TestService {}

      expect(isInjectable(TestService)).toBe(true);
    });

    it('should store injectable options', () => {
      @Injectable({ scope: 'transient' })
      class TestService {}

      const options = getInjectableOptions(TestService);
      expect(options?.scope).toBe('transient');
    });

    it('should default to singleton scope', () => {
      @Injectable()
      class TestService {}

      const options = getInjectableOptions(TestService);
      expect(options?.scope).toBe('singleton');
    });

    it('should support providedIn option', () => {
      @Injectable({ providedIn: 'root' })
      class TestService {}

      const options = getInjectableOptions(TestService);
      expect(options?.providedIn).toBe('root');
    });
  });

  describe('injectable() function', () => {
    it('should create injectable from factory function', () => {
      const CounterService = injectable(() => {
        let count = 0;
        return {
          increment: () => ++count,
          getCount: () => count,
        };
      });

      expect(isInjectable(CounterService)).toBe(true);
    });

    it('should create singleton instance by default', () => {
      const CounterService = injectable(() => {
        let count = 0;
        return {
          increment: () => ++count,
          getCount: () => count,
        };
      });

      const instance1 = new CounterService() as any;
      const instance2 = new CounterService() as any;

      instance1.increment();
      instance1.increment();

      expect(instance2.getCount()).toBe(2);
    });

    it('should create transient instances when specified', () => {
      const IdGenerator = injectable(
        () => ({
          id: Math.random(),
        }),
        { scope: 'transient' }
      );

      const instance1 = new IdGenerator() as any;
      const instance2 = new IdGenerator() as any;

      expect(instance1.id).not.toBe(instance2.id);
    });

    it('should support complex return types', () => {
      interface UserService {
        users: string[];
        addUser: (name: string) => void;
        getUsers: () => string[];
      }

      const UserService = injectable<UserService>(() => {
        const users: string[] = [];
        return {
          users,
          addUser: (name: string) => users.push(name),
          getUsers: () => [...users],
        };
      });

      const service = new UserService() as any;
      service.addUser('Alice');
      service.addUser('Bob');

      expect(service.getUsers()).toEqual(['Alice', 'Bob']);
    });
  });

  describe('isInjectable', () => {
    it('should return true for injectable class', () => {
      @Injectable()
      class TestService {}

      expect(isInjectable(TestService)).toBe(true);
    });

    it('should return true for injectable function', () => {
      const Service = injectable(() => ({}));
      expect(isInjectable(Service)).toBe(true);
    });

    it('should return false for non-injectable class', () => {
      class TestService {}
      expect(isInjectable(TestService)).toBe(false);
    });

    it('should return false for plain object', () => {
      expect(isInjectable({})).toBe(false);
    });
  });

  describe('getInjectableOptions', () => {
    it('should return options for injectable class', () => {
      @Injectable({ scope: 'module', providedIn: 'root' })
      class TestService {}

      const options = getInjectableOptions(TestService);
      expect(options?.scope).toBe('module');
      expect(options?.providedIn).toBe('root');
    });

    it('should return undefined for non-injectable class', () => {
      class TestService {}
      expect(getInjectableOptions(TestService)).toBeUndefined();
    });
  });
});
