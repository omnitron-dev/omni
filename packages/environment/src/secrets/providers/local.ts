import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { decrypt, encrypt, EncryptedData } from '../encryption.js';
import { BaseSecretsProvider } from './base.js';

export interface LocalProviderOptions {
  storagePath: string;
  password: string;
  autoInit?: boolean;
}

interface SecretsStore {
  version: string;
  secrets: Record<string, EncryptedData>;
}

/**
 * Local encrypted secrets provider
 * Stores secrets encrypted with AES-256-GCM on the local filesystem
 */
export class LocalSecretsProvider extends BaseSecretsProvider {
  readonly type = 'local' as const;

  private storagePath: string;
  private password: string;
  private secrets: Map<string, string> = new Map();
  private initialized = false;

  constructor(options: LocalProviderOptions) {
    super();
    this.storagePath = options.storagePath;
    this.password = options.password;

    if (options.autoInit) {
      this.initialize().catch((err) => {
        console.error('Failed to initialize local secrets provider:', err);
      });
    }
  }

  /**
   * Initialize the provider - load encrypted secrets from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Check if storage file exists
      await fs.access(this.storagePath);

      // Read and decrypt secrets
      const content = await fs.readFile(this.storagePath, 'utf8');
      const store: SecretsStore = JSON.parse(content);

      // Decrypt all secrets
      for (const [key, encryptedData] of Object.entries(store.secrets)) {
        try {
          const decrypted = decrypt(encryptedData, this.password);
          this.secrets.set(key, decrypted);
        } catch (error) {
          console.error(`Failed to decrypt secret '${key}':`, error);
        }
      }

      this.initialized = true;
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File doesn't exist yet, initialize empty
        this.initialized = true;
      } else {
        throw new Error(`Failed to initialize local secrets provider: ${error.message}`);
      }
    }
  }

  /**
   * Get a secret by key
   */
  async get(key: string): Promise<string | null> {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.secrets.get(key) || null;
  }

  /**
   * Set a secret by key
   */
  async set(key: string, value: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.secrets.set(key, value);
    await this.persist();
  }

  /**
   * Delete a secret by key
   */
  async delete(key: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize();
    }

    this.secrets.delete(key);
    await this.persist();
  }

  /**
   * List all secret keys
   */
  async list(): Promise<string[]> {
    if (!this.initialized) {
      await this.initialize();
    }

    return Array.from(this.secrets.keys());
  }

  /**
   * Persist secrets to disk (encrypted)
   */
  private async persist(): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.storagePath);
    await fs.mkdir(dir, { recursive: true });

    // Encrypt all secrets
    const encryptedSecrets: Record<string, EncryptedData> = {};
    for (const [key, value] of this.secrets.entries()) {
      encryptedSecrets[key] = encrypt(value, this.password);
    }

    const store: SecretsStore = {
      version: '1.0',
      secrets: encryptedSecrets
    };

    // Write to disk
    await fs.writeFile(this.storagePath, JSON.stringify(store, null, 2), 'utf8');
  }

  /**
   * Clear all secrets from memory (for security)
   */
  clearMemory(): void {
    this.secrets.clear();
    this.initialized = false;
  }
}
