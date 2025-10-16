import * as crypto from 'node:crypto';

/**
 * Encryption utilities using AES-256-GCM
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const KEY_LENGTH = 32;

export interface EncryptedData {
  encrypted: string;
  iv: string;
  authTag: string;
  salt: string;
}

/**
 * Derive a key from a password using PBKDF2
 */
export function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, 100000, KEY_LENGTH, 'sha512');
}

/**
 * Generate a random encryption key
 */
export function generateKey(): string {
  return crypto.randomBytes(KEY_LENGTH).toString('base64');
}

/**
 * Generate a random salt
 */
export function generateSalt(): Buffer {
  return crypto.randomBytes(SALT_LENGTH);
}

/**
 * Encrypt data using AES-256-GCM
 */
export function encrypt(data: string, password: string): EncryptedData {
  // Generate random salt and IV
  const salt = generateSalt();
  const iv = crypto.randomBytes(IV_LENGTH);

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  // Encrypt data
  let encrypted = cipher.update(data, 'utf8', 'base64');
  encrypted += cipher.final('base64');

  // Get authentication tag
  const authTag = cipher.getAuthTag();

  return {
    encrypted,
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    salt: salt.toString('base64')
  };
}

/**
 * Decrypt data using AES-256-GCM
 */
export function decrypt(encryptedData: EncryptedData, password: string): string {
  // Decode base64 values
  const iv = Buffer.from(encryptedData.iv, 'base64');
  const authTag = Buffer.from(encryptedData.authTag, 'base64');
  const salt = Buffer.from(encryptedData.salt, 'base64');

  // Derive key from password
  const key = deriveKey(password, salt);

  // Create decipher
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Decrypt data
  let decrypted = decipher.update(encryptedData.encrypted, 'base64', 'utf8');
  decrypted += decipher.final('utf8');

  return decrypted;
}

/**
 * Hash a password using SHA-256
 */
export function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('base64');
}

/**
 * Generate a random password
 */
export function generatePassword(length: number = 32): string {
  return crypto.randomBytes(Math.ceil(length / 2)).toString('hex').slice(0, length);
}

/**
 * Securely compare two strings in constant time
 */
export function constantTimeCompare(a: string, b: string): boolean {
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
