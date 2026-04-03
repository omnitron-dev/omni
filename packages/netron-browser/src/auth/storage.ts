/**
 * Token storage implementations for browser
 */

import type { TokenStorage } from './types.js';

/**
 * LocalStorage-based token storage
 */
export class LocalTokenStorage implements TokenStorage {
  private key: string;

  constructor(key = 'netron_auth_token') {
    this.key = key;
  }

  getToken(): string | null {
    try {
      return localStorage.getItem(this.key);
    } catch {
      // localStorage might not be available (SSR, private browsing, etc.)
      return null;
    }
  }

  setToken(token: string): void {
    try {
      localStorage.setItem(this.key, token);
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  removeToken(): void {
    try {
      localStorage.removeItem(this.key);
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getValue(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setValue(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Silently fail if localStorage is not available
    }
  }

  removeValue(key: string): void {
    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail if localStorage is not available
    }
  }
}

/**
 * SessionStorage-based token storage
 */
export class SessionTokenStorage implements TokenStorage {
  private key: string;

  constructor(key = 'netron_auth_token') {
    this.key = key;
  }

  getToken(): string | null {
    try {
      return sessionStorage.getItem(this.key);
    } catch {
      // sessionStorage might not be available
      return null;
    }
  }

  setToken(token: string): void {
    try {
      sessionStorage.setItem(this.key, token);
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }

  removeToken(): void {
    try {
      sessionStorage.removeItem(this.key);
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }

  hasToken(): boolean {
    return this.getToken() !== null;
  }

  getValue(key: string): string | null {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  }

  setValue(key: string, value: string): void {
    try {
      sessionStorage.setItem(key, value);
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }

  removeValue(key: string): void {
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Silently fail if sessionStorage is not available
    }
  }
}

/**
 * In-memory token storage (no persistence)
 */
export class MemoryTokenStorage implements TokenStorage {
  private token: string | null = null;
  private values = new Map<string, string>();

  getToken(): string | null {
    return this.token;
  }

  setToken(token: string): void {
    this.token = token;
  }

  removeToken(): void {
    this.token = null;
  }

  hasToken(): boolean {
    return this.token !== null;
  }

  getValue(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setValue(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeValue(key: string): void {
    this.values.delete(key);
  }
}
