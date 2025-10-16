import { ISecretsProvider } from '../../types/layers.js';

/**
 * Base secrets provider interface
 */
export abstract class BaseSecretsProvider implements ISecretsProvider {
  abstract readonly type: 'local' | 'vault' | 'aws-secrets' | '1password' | 'env';

  /**
   * Initialize the provider
   */
  abstract initialize(): Promise<void>;

  /**
   * Get a secret by key
   */
  abstract get(key: string): Promise<string | null>;

  /**
   * Set a secret by key
   */
  abstract set(key: string, value: string): Promise<void>;

  /**
   * Delete a secret by key
   */
  abstract delete(key: string): Promise<void>;

  /**
   * List all secret keys
   */
  abstract list(): Promise<string[]>;
}
