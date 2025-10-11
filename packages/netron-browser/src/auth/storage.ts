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
}

/**
 * In-memory token storage (no persistence)
 */
export class MemoryTokenStorage implements TokenStorage {
  private token: string | null = null;

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
}
