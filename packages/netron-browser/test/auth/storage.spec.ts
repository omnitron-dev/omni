/**
 * Tests for token storage implementations
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LocalTokenStorage,
  SessionTokenStorage,
  MemoryTokenStorage,
} from '../../src/auth/storage.js';

describe('MemoryTokenStorage', () => {
  let storage: MemoryTokenStorage;

  beforeEach(() => {
    storage = new MemoryTokenStorage();
  });

  it('should store and retrieve token', () => {
    storage.setToken('test-token');
    expect(storage.getToken()).toBe('test-token');
    expect(storage.hasToken()).toBe(true);
  });

  it('should remove token', () => {
    storage.setToken('test-token');
    storage.removeToken();
    expect(storage.getToken()).toBeNull();
    expect(storage.hasToken()).toBe(false);
  });

  it('should return null for missing token', () => {
    expect(storage.getToken()).toBeNull();
    expect(storage.hasToken()).toBe(false);
  });
});

describe('LocalTokenStorage', () => {
  let storage: LocalTokenStorage;

  beforeEach(() => {
    // Clear localStorage before each test
    if (typeof localStorage !== 'undefined') {
      localStorage.clear();
    }
    storage = new LocalTokenStorage('test_token');
  });

  it('should store and retrieve token from localStorage', () => {
    if (typeof localStorage === 'undefined') {
      console.log('localStorage not available, skipping test');
      return;
    }

    storage.setToken('test-token');
    expect(storage.getToken()).toBe('test-token');
    expect(storage.hasToken()).toBe(true);
  });

  it('should remove token from localStorage', () => {
    if (typeof localStorage === 'undefined') {
      console.log('localStorage not available, skipping test');
      return;
    }

    storage.setToken('test-token');
    storage.removeToken();
    expect(storage.getToken()).toBeNull();
    expect(storage.hasToken()).toBe(false);
  });
});

describe('SessionTokenStorage', () => {
  let storage: SessionTokenStorage;

  beforeEach(() => {
    // Clear sessionStorage before each test
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.clear();
    }
    storage = new SessionTokenStorage('test_token');
  });

  it('should store and retrieve token from sessionStorage', () => {
    if (typeof sessionStorage === 'undefined') {
      console.log('sessionStorage not available, skipping test');
      return;
    }

    storage.setToken('test-token');
    expect(storage.getToken()).toBe('test-token');
    expect(storage.hasToken()).toBe(true);
  });

  it('should remove token from sessionStorage', () => {
    if (typeof sessionStorage === 'undefined') {
      console.log('sessionStorage not available, skipping test');
      return;
    }

    storage.setToken('test-token');
    storage.removeToken();
    expect(storage.getToken()).toBeNull();
    expect(storage.hasToken()).toBe(false);
  });
});
