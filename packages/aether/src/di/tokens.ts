/**
 * Dependency Injection - Injection Tokens
 *
 * Tokens for primitives and interfaces
 */

import type { InjectionTokenType as IInjectionToken } from './types.js';

/**
 * InjectionToken class for type-safe tokens
 *
 * @example
 * ```typescript
 * export const API_URL = new InjectionToken<string>('API_URL');
 * export const LOGGER = new InjectionToken<Logger>('LOGGER');
 * ```
 */
export class InjectionToken<T = any> implements IInjectionToken<T> {
  readonly _type!: T;
  readonly _desc: string;

  constructor(description: string) {
    this._desc = description;
  }

  toString(): string {
    return `InjectionToken(${this._desc})`;
  }
}

/**
 * Create an injection token
 *
 * @param description - Token description for debugging
 * @returns Injection token
 */
export function createInjectionToken<T>(description: string): InjectionToken<T> {
  return new InjectionToken<T>(description);
}
