/**
 * Minimal Netron HTTP Client for Browser E2E Tests
 * Standalone implementation without Node.js dependencies
 */

export class HttpNetronClient {
  constructor(options) {
    this.baseUrl = options.baseUrl;
    this.timeout = options.timeout || 30000;
    this.headers = options.headers || {};
  }

  async initialize() {
    // No-op for HTTP client
    console.log('HTTP Netron client initialized');
  }

  async queryInterface(serviceName) {
    const [name, version] = serviceName.split('@');

    return new Proxy(
      {},
      {
        get: (target, method) => {
          return async (...args) => {
            return this.invoke(serviceName, method, args);
          };
        },
      }
    );
  }

  async invoke(serviceName, methodName, args) {
    const url = `${this.baseUrl}/netron/invoke`;

    const body = {
      id: Math.random().toString(36).substring(2, 15),
      version: '2.0',
      timestamp: Date.now(),
      service: serviceName,
      method: methodName,
      input: args || [],
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error?.message || 'RPC error');
      }

      return result.data;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  async close() {
    // No-op for HTTP client
  }

  getMetrics() {
    return {
      clientId: 'browser-client',
      baseUrl: this.baseUrl,
    };
  }
}
