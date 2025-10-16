import { AccessLog, ISecretsLayer, ISecretsProvider } from '../types/layers.js';

/**
 * Secrets layer implementation
 */
export class SecretsLayer implements ISecretsLayer {
  readonly provider: ISecretsProvider;
  private accessLogs: Map<string, AccessLog[]> = new Map();

  constructor(provider: ISecretsProvider) {
    this.provider = provider;
  }

  /**
   * Get a secret by key
   */
  async get(key: string): Promise<string | null> {
    const value = await this.provider.get(key);

    // Log access
    this.logAccess(key, 'read');

    return value;
  }

  /**
   * Set a secret by key
   */
  async set(key: string, value: string): Promise<void> {
    await this.provider.set(key, value);

    // Log access
    this.logAccess(key, 'write');
  }

  /**
   * Check if secret exists
   */
  async has(key: string): Promise<boolean> {
    const value = await this.provider.get(key);
    return value !== null;
  }

  /**
   * Delete a secret
   */
  async delete(key: string): Promise<void> {
    await this.provider.delete(key);

    // Log access
    this.logAccess(key, 'delete');
  }

  /**
   * Get all secrets
   */
  async getAll(): Promise<Record<string, string>> {
    const keys = await this.provider.list();
    const secrets: Record<string, string> = {};

    for (const key of keys) {
      const value = await this.provider.get(key);
      if (value !== null) {
        secrets[key] = value;
      }
    }

    return secrets;
  }

  /**
   * Set multiple secrets at once
   */
  async setAll(secrets: Record<string, string>): Promise<void> {
    for (const [key, value] of Object.entries(secrets)) {
      await this.provider.set(key, value);
    }
  }

  /**
   * Rotate a secret (generate new value)
   */
  async rotate(key: string): Promise<void> {
    // Get current value
    const currentValue = await this.provider.get(key);
    if (!currentValue) {
      throw new Error(`Secret '${key}' does not exist`);
    }

    // Generate new value (simple implementation - in real scenarios, this would call external APIs)
    const newValue = this.generateRotatedValue(currentValue);

    // Set new value
    await this.provider.set(key, newValue);

    // Log rotation
    this.logAccess(key, 'write');
  }

  /**
   * Rotate all secrets
   */
  async rotateAll(): Promise<void> {
    const keys = await this.provider.list();

    for (const key of keys) {
      await this.rotate(key);
    }
  }

  /**
   * Get access log for a secret
   */
  async getAccessLog(key: string): Promise<AccessLog[]> {
    return this.accessLogs.get(key) || [];
  }

  /**
   * Interpolate secret references in a template
   * Replaces ${secret:key} with actual secret values
   */
  async interpolate(template: string): Promise<string> {
    const secretPattern = /\$\{secret:([^}]+)\}/g;
    let result = template;

    const matches = template.matchAll(secretPattern);
    for (const match of matches) {
      const key = match[1];
      const value = await this.get(key);

      if (value !== null) {
        result = result.replace(match[0], value);
      }
    }

    return result;
  }

  /**
   * Log access to a secret
   */
  private logAccess(key: string, action: 'read' | 'write' | 'delete'): void {
    if (!this.accessLogs.has(key)) {
      this.accessLogs.set(key, []);
    }

    const log: AccessLog = {
      key,
      timestamp: new Date(),
      user: 'system', // TODO: Get from context
      action,
    };

    this.accessLogs.get(key)!.push(log);

    // Keep only last 100 entries per key
    const logs = this.accessLogs.get(key)!;
    if (logs.length > 100) {
      this.accessLogs.set(key, logs.slice(-100));
    }
  }

  /**
   * Generate a rotated value (simple implementation)
   */
  private generateRotatedValue(currentValue: string): string {
    // In a real implementation, this would:
    // 1. Call external API to generate new credentials
    // 2. Update remote systems with new value
    // 3. Return the new value
    // For now, we just append a timestamp
    return `${currentValue}-rotated-${Date.now()}`;
  }
}
