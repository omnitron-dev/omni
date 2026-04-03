/**
 * Secrets Service — Encrypted Secrets Storage
 *
 * Stores secrets (API keys, DB passwords, signing keys) encrypted at rest
 * in a JSON file using AES-256-GCM.
 *
 * Key derivation: scrypt(passphrase + machineId, salt, 64) → 32-byte key
 * Encryption: AES-256-GCM with random IV per encryption
 * Storage: ~/.omnitron/secrets.enc (JSON envelope with salt, iv, ciphertext, tag)
 *
 * Zero external dependencies — uses Node.js native crypto.
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
} from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const scryptAsync = promisify(scrypt);

// =============================================================================
// Types
// =============================================================================

/** Encrypted file envelope — stored as JSON */
interface SecretsEnvelope {
  /** Version of the envelope format */
  version: 1;
  /** scrypt salt (hex) */
  salt: string;
  /** AES-256-GCM IV (hex) */
  iv: string;
  /** Ciphertext (hex) */
  ciphertext: string;
  /** GCM auth tag (hex) */
  tag: string;
}

/** Decrypted secrets store */
type SecretsMap = Record<string, string>;

// =============================================================================
// Constants
// =============================================================================

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32; // 256 bits
const SALT_LENGTH = 32;
const IV_LENGTH = 16;
// scrypt parameters are controlled via Node's defaults (N=16384, r=8, p=1)
// which match our production requirements. Custom tuning can be added
// by passing options to scryptAsync if needed in the future.

// =============================================================================
// Service
// =============================================================================

export class SecretsService {
  private cache: SecretsMap | null = null;

  constructor(
    private readonly filePath: string,
    private passphrase: string
  ) {}

  // ===========================================================================
  // Public API
  // ===========================================================================

  /**
   * Get a secret by key.
   * Returns null if the key doesn't exist or the secrets file is missing.
   */
  async get(key: string): Promise<string | null> {
    const secrets = await this.load();
    return secrets[key] ?? null;
  }

  /**
   * Set a secret. Creates or updates the value for the given key.
   * Writes the encrypted file immediately.
   */
  async set(key: string, value: string): Promise<void> {
    const secrets = await this.load();
    secrets[key] = value;
    await this.save(secrets);
  }

  /**
   * Delete a secret by key.
   * Returns true if the key existed and was deleted.
   */
  async delete(key: string): Promise<boolean> {
    const secrets = await this.load();
    if (!(key in secrets)) return false;
    delete secrets[key];
    await this.save(secrets);
    return true;
  }

  /**
   * List all secret keys (values are NOT returned).
   */
  async list(): Promise<string[]> {
    const secrets = await this.load();
    return Object.keys(secrets);
  }

  /**
   * Rotate the encryption key by re-encrypting with a new passphrase.
   * The old passphrase must match the current encryption.
   */
  async rotate(oldPassphrase: string, newPassphrase: string): Promise<void> {
    // Decrypt with old passphrase
    const oldService = new SecretsService(this.filePath, oldPassphrase);
    const secrets = await oldService.load();

    // Re-encrypt with new passphrase
    const newService = new SecretsService(this.filePath, newPassphrase);
    await newService.save(secrets);

    // Update our own passphrase reference
    this.passphrase = newPassphrase;
    this.cache = secrets;
  }

  /**
   * Check if the secrets file exists.
   */
  exists(): boolean {
    return existsSync(this.filePath);
  }

  // ===========================================================================
  // Encryption / Decryption
  // ===========================================================================

  private async deriveKey(salt: Buffer): Promise<Buffer> {
    // Combine passphrase with machine-id for additional binding
    const machineId = await this.getMachineId();
    const combined = `${this.passphrase}:${machineId}`;
    return scryptAsync(combined, salt, KEY_LENGTH) as Promise<Buffer>;
  }

  private async encrypt(data: SecretsMap): Promise<SecretsEnvelope> {
    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = await this.deriveKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    const plaintext = JSON.stringify(data);

    let ciphertext = cipher.update(plaintext, 'utf8', 'hex');
    ciphertext += cipher.final('hex');
    const tag = cipher.getAuthTag();

    return {
      version: 1,
      salt: salt.toString('hex'),
      iv: iv.toString('hex'),
      ciphertext,
      tag: tag.toString('hex'),
    };
  }

  private async decrypt(envelope: SecretsEnvelope): Promise<SecretsMap> {
    const salt = Buffer.from(envelope.salt, 'hex');
    const iv = Buffer.from(envelope.iv, 'hex');
    const tag = Buffer.from(envelope.tag, 'hex');
    const key = await this.deriveKey(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let plaintext = decipher.update(envelope.ciphertext, 'hex', 'utf8');
    plaintext += decipher.final('utf8');

    return JSON.parse(plaintext) as SecretsMap;
  }

  // ===========================================================================
  // Persistence
  // ===========================================================================

  private async load(): Promise<SecretsMap> {
    if (this.cache) return this.cache;

    if (!existsSync(this.filePath)) {
      this.cache = {};
      return this.cache;
    }

    try {
      const raw = await readFile(this.filePath, 'utf8');
      const envelope = JSON.parse(raw) as SecretsEnvelope;

      if (envelope.version !== 1) {
        throw new Error(`Unsupported secrets envelope version: ${envelope.version}`);
      }

      this.cache = await this.decrypt(envelope);
      return this.cache;
    } catch (err) {
      if ((err as Error).message.includes('Unsupported')) throw err;
      throw new Error(`Failed to decrypt secrets file: ${(err as Error).message}. Wrong passphrase?`, { cause: err });
    }
  }

  private async save(secrets: SecretsMap): Promise<void> {
    // Ensure directory exists
    const dir = path.dirname(this.filePath);
    await mkdir(dir, { recursive: true });

    const envelope = await this.encrypt(secrets);
    await writeFile(this.filePath, JSON.stringify(envelope, null, 2), {
      mode: 0o600, // Owner-only read/write
    });

    this.cache = secrets;
  }

  // ===========================================================================
  // Machine ID
  // ===========================================================================

  /**
   * Get a stable machine identifier for key derivation.
   * Falls back to hostname if machine-id is unavailable.
   */
  private async getMachineId(): Promise<string> {
    try {
      // Linux: /etc/machine-id
      const { readFile: readFs } = await import('node:fs/promises');
      try {
        const id = await readFs('/etc/machine-id', 'utf8');
        if (id.trim()) return id.trim();
      } catch {
        // Not Linux
      }

      // macOS: IOPlatformUUID via system_profiler
      try {
        const { execSync } = await import('node:child_process');
        const output = execSync(
          'ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID',
          { encoding: 'utf8', timeout: 5000 }
        );
        const match = output.match(/"IOPlatformUUID"\s*=\s*"([^"]+)"/);
        if (match?.[1]) return match[1];
      } catch {
        // Not macOS or command failed
      }

      // Fallback: hostname
      const os = await import('node:os');
      return os.hostname();
    } catch {
      return 'omnitron-default-machine-id';
    }
  }
}
