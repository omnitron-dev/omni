/**
 * HTTP-specific Interface implementation for Netron
 * Creates proxy objects that make HTTP requests instead of WebSocket calls
 */

import { Definition } from '../../definition.js';
import type { MethodContract } from '../../../validation/contract.js';

/**
 * Service route information for HTTP
 */
interface HttpRoute {
  serviceName: string;
  methodName: string;
  pattern: string;
  method: string;
  contract?: MethodContract;
}

/**
 * HTTP Interface - creates proxy objects for services accessed over HTTP
 */
export class HttpInterface {
  private routes = new Map<string, HttpRoute>();

  constructor(
    private baseUrl: string,
    private definition: Definition,
    private contract?: any,
    private options?: any
  ) {
    this.buildRoutes();
  }

  /**
   * Build HTTP routes from contract
   */
  private buildRoutes(): void {
    const methods = this.definition.meta?.methods || {};

    // If no methods in definition but we have a contract, use contract methods
    const contractMethods = this.contract?.definition || this.contract || {};
    const allMethods = Object.keys(methods).length > 0
      ? Object.keys(methods)
      : Object.keys(contractMethods);

    for (const methodName of allMethods) {
      const methodContract = this.contract?.definition?.[methodName] || this.contract?.[methodName];
      const http = methodContract?.http;

      if (http?.path && http?.method) {
        // REST-style endpoint from contract
        this.routes.set(methodName, {
          serviceName: this.definition.meta.name,
          methodName,
          pattern: http.path,
          method: http.method,
          contract: methodContract
        });
      } else {
        // Default RPC-style endpoint
        this.routes.set(methodName, {
          serviceName: this.definition.meta.name,
          methodName,
          pattern: `/rpc/${methodName}`,
          method: 'POST',
          contract: methodContract
        });
      }
    }
  }

  /**
   * Create the proxy object
   */
  createProxy(): any {
    const self = this;

    return new Proxy({}, {
      get(target: any, prop: string) {
        // Check if it's a method
        const route = self.routes.get(prop);
        if (route) {
          // Return a function that makes the HTTP request
          return async (...args: any[]) => 
             self.callMethod(prop, args[0]) // Netron passes single input object
          ;
        }

        // Check for special properties
        if (prop === '$def') {
          return self.definition;
        }

        if (prop === 'then' || prop === 'catch' || prop === 'finally') {
          // Not a promise
          return undefined;
        }

        // Unknown property
        return undefined;
      }
    });
  }

  /**
   * Call a service method over HTTP
   */
  private async callMethod(methodName: string, input: any): Promise<any> {
    const route = this.routes.get(methodName);
    if (!route) {
      throw new Error(`Method ${methodName} not found`);
    }

    // Build URL and request
    let url = this.baseUrl + route.pattern;
    let body: any = undefined;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...this.options?.headers
    };

    const http = route.contract?.http;

    // Handle path parameters
    if (http?.params && input) {
      for (const [key, value] of Object.entries(input)) {
        url = url.replace(`{${key}}`, encodeURIComponent(String(value)));
        url = url.replace(`:${key}`, encodeURIComponent(String(value)));
      }
    }

    // Handle query parameters for GET requests
    if (route.method === 'GET' && input) {
      const urlObj = new URL(url);
      const queryParams = http?.params ?
        Object.keys((http.params as any)?._def?.shape || {}) : [];

      for (const [key, value] of Object.entries(input)) {
        // Skip path parameters
        if (!queryParams.includes(key) && !url.includes(`{${key}}`)) {
          urlObj.searchParams.set(key, String(value));
        }
      }
      url = urlObj.toString();
    } else if (route.method !== 'GET') {
      // Send as JSON body for non-GET requests
      body = JSON.stringify(input);
    }

    // Make the HTTP request
    const response = await fetch(url, {
      method: route.method,
      headers,
      body,
      signal: this.options?.signal
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({
        message: `HTTP ${response.status} ${response.statusText}`
      }));
      throw new Error(error.message || 'HTTP request failed');
    }

    return response.json();
  }
}