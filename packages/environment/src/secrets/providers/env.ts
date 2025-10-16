import { BaseSecretsProvider } from './base.js';

export interface EnvProviderOptions {
  prefix?: string;
}

/**
 * Environment variable secrets provider
 * Reads secrets from environment variables
 */
export class EnvSecretsProvider extends BaseSecretsProvider {
  readonly type = 'env' as const;

  private prefix: string;

  constructor(options: EnvProviderOptions = {}) {
    super();
    this.prefix = options.prefix || 'SECRET_';
  }

  /**
   * Initialize the provider
   */
  async initialize(): Promise<void> {
    // Nothing to initialize for env provider
  }

  /**
   * Get a secret from environment variables
   */
  async get(key: string): Promise<string | null> {
    const envKey = this.prefix + key.toUpperCase().replace(/\./g, '_');
    return process.env[envKey] || null;
  }

  /**
   * Set is not supported for environment variables
   */
  async set(key: string, value: string): Promise<void> {
    const envKey = this.prefix + key.toUpperCase().replace(/\./g, '_');
    process.env[envKey] = value;
  }

  /**
   * Delete is not supported for environment variables
   */
  async delete(key: string): Promise<void> {
    const envKey = this.prefix + key.toUpperCase().replace(/\./g, '_');
    delete process.env[envKey];
  }

  /**
   * List all secret keys from environment variables
   */
  async list(): Promise<string[]> {
    const keys: string[] = [];

    for (const key of Object.keys(process.env)) {
      if (key.startsWith(this.prefix)) {
        const secretKey = key
          .substring(this.prefix.length)
          .toLowerCase()
          .replace(/_/g, '.');
        keys.push(secretKey);
      }
    }

    return keys;
  }
}
