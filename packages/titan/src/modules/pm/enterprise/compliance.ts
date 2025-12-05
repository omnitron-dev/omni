/**
 * Compliance and Audit Logging Implementation
 *
 * Provides comprehensive compliance, audit logging, and data governance capabilities
 */

import { EventEmitter } from 'events';
import { randomUUID } from 'crypto';
import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes } from 'crypto';

import { Errors } from '../../../errors/index.js';
/**
 * Compliance Standards
 */
export enum ComplianceStandard {
  GDPR = 'GDPR',
  HIPAA = 'HIPAA',
  SOC2 = 'SOC2',
  PCI_DSS = 'PCI-DSS',
  ISO_27001 = 'ISO-27001',
  CCPA = 'CCPA',
  FedRAMP = 'FedRAMP',
}

/**
 * Audit Event
 */
export interface AuditEvent {
  id: string;
  timestamp: number;
  actor: AuditActor;
  action: string;
  resource: AuditResource;
  outcome: 'success' | 'failure';
  metadata?: Record<string, any>;
  pii?: boolean;
  redacted?: string[];
  hash?: string;
  signature?: string;
}

/**
 * Audit Actor
 */
export interface AuditActor {
  type: 'user' | 'service' | 'system';
  id: string;
  name?: string;
  ip?: string;
  sessionId?: string;
  metadata?: Record<string, any>;
}

/**
 * Audit Resource
 */
export interface AuditResource {
  type: string;
  id: string;
  name?: string;
  metadata?: Record<string, any>;
}

/**
 * Audit Configuration
 */
export interface AuditConfig {
  level: 'none' | 'minimal' | 'standard' | 'full';
  retention: string; // e.g., '7y', '30d'
  encryption: boolean;
  immutable: boolean;
  redactPII: boolean;
  standards: ComplianceStandard[];
  storage?: AuditStorageConfig;
  /**
   * HMAC key for signing audit events (required when immutable=true)
   * MUST be provided from secure key management (e.g., AWS KMS, HashiCorp Vault)
   * Should be at least 256 bits (32 bytes) for security
   */
  signingKey?: Buffer | string;
  /**
   * Encryption key for encrypting sensitive audit data (required when encryption=true)
   * MUST be provided from secure key management
   * Should be exactly 256 bits (32 bytes) for AES-256
   */
  encryptionKey?: Buffer | string;
}

/**
 * Audit Storage Configuration
 */
export interface AuditStorageConfig {
  type: 'memory' | 'file' | 'database' | 's3';
  path?: string;
  rotation?: 'daily' | 'weekly' | 'monthly';
  compression?: boolean;
  archival?: {
    enabled: boolean;
    after: string; // e.g., '30d'
    location: string;
  };
}

/**
 * PII Detection Pattern
 */
interface PIIPattern {
  name: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Data Classification
 */
export enum DataClassification {
  PUBLIC = 'public',
  INTERNAL = 'internal',
  CONFIDENTIAL = 'confidential',
  RESTRICTED = 'restricted',
}

/**
 * GDPR Rights
 */
export interface GDPRRights {
  access: boolean;
  rectification: boolean;
  erasure: boolean;
  portability: boolean;
  restriction: boolean;
  objection: boolean;
}

/**
 * Audit Logger
 *
 * Production-grade audit logging with proper cryptographic security.
 * Keys MUST be provided from secure key management systems.
 */
export class AuditLogger extends EventEmitter {
  private events: AuditEvent[] = [];
  private encryptionKey?: Buffer;
  private signingKey?: Buffer;
  private piiPatterns: PIIPattern[] = [
    // US Social Security Number
    { name: 'ssn', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '***-**-****' },
    // Credit Card Numbers (various formats)
    { name: 'creditCard', pattern: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '****-****-****-****' },
    // Email addresses
    { name: 'email', pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, replacement: '***@***.***' },
    // US Phone numbers
    { name: 'phone', pattern: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g, replacement: '***-***-****' },
    // IP addresses (IPv4)
    { name: 'ipAddress', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, replacement: '***.***.***.***' },
    // Passport numbers (common formats)
    { name: 'passport', pattern: /\b[A-Z]{1,2}\d{6,9}\b/gi, replacement: '***PASSPORT***' },
    // Date of birth (YYYY-MM-DD format)
    { name: 'dob', pattern: /\b(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])\b/g, replacement: '****-**-**' },
    // IBAN (International Bank Account Number)
    { name: 'iban', pattern: /\b[A-Z]{2}\d{2}[A-Z0-9]{4,30}\b/gi, replacement: '***IBAN***' },
    // US Driver's License (common formats)
    { name: 'driversLicense', pattern: /\b[A-Z]{1,2}\d{5,8}\b/gi, replacement: '***DL***' },
  ];

  constructor(private config: AuditConfig) {
    super();

    // Validate and setup encryption key
    if (config.encryption) {
      if (!config.encryptionKey) {
        throw Errors.badRequest(
          'Encryption is enabled but no encryptionKey provided. ' +
            'Keys MUST be provided from secure key management (AWS KMS, HashiCorp Vault, etc.)',
          { field: 'encryptionKey' }
        );
      }
      this.encryptionKey = this.normalizeKey(config.encryptionKey, 32, 'encryptionKey');
    }

    // Validate and setup signing key
    if (config.immutable) {
      if (!config.signingKey) {
        throw Errors.badRequest(
          'Immutable mode is enabled but no signingKey provided. ' +
            'Keys MUST be provided from secure key management (AWS KMS, HashiCorp Vault, etc.)',
          { field: 'signingKey' }
        );
      }
      this.signingKey = this.normalizeKey(config.signingKey, 32, 'signingKey');
    }
  }

  /**
   * Normalize a key to a Buffer of the required length
   */
  private normalizeKey(key: Buffer | string, requiredLength: number, keyName: string): Buffer {
    let keyBuffer: Buffer;

    if (Buffer.isBuffer(key)) {
      keyBuffer = key;
    } else if (typeof key === 'string') {
      // Try to decode as hex first, then as base64, then as UTF-8
      if (/^[0-9a-fA-F]+$/.test(key) && key.length === requiredLength * 2) {
        keyBuffer = Buffer.from(key, 'hex');
      } else if (/^[A-Za-z0-9+/=]+$/.test(key)) {
        keyBuffer = Buffer.from(key, 'base64');
      } else {
        // Use SHA-256 to derive a key from the string (not recommended for production)
        this.emit('warning', {
          message: `${keyName} provided as plain string. Using SHA-256 to derive key. ` +
            'For production, provide a proper 256-bit key from key management.',
        });
        keyBuffer = createHash('sha256').update(key).digest();
      }
    } else {
      throw Errors.badRequest(`${keyName} must be a Buffer or string`, { field: keyName });
    }

    if (keyBuffer.length < requiredLength) {
      throw Errors.badRequest(
        `${keyName} is too short (${keyBuffer.length} bytes). Required: ${requiredLength} bytes (${requiredLength * 8} bits)`,
        { field: keyName }
      );
    }

    return keyBuffer.subarray(0, requiredLength);
  }

  /**
   * Log audit event
   */
  log(event: Omit<AuditEvent, 'id' | 'timestamp' | 'hash' | 'signature'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      id: randomUUID(),
      timestamp: Date.now(),
    };

    // Redact PII if configured
    if (this.config.redactPII && event.pii) {
      fullEvent.metadata = this.redactPII(event.metadata || {});
      fullEvent.redacted = this.detectPII(JSON.stringify(event.metadata || {}));
    }

    // Add integrity hash
    if (this.config.immutable) {
      fullEvent.hash = this.generateHash(fullEvent);
      fullEvent.signature = this.generateSignature(fullEvent);
    }

    // Encrypt if configured
    const storedEvent = this.config.encryption ? this.encryptEvent(fullEvent) : fullEvent;

    this.events.push(storedEvent);
    // Emit the encrypted event if encryption is enabled
    this.emit('event:logged', storedEvent);

    // Check retention and rotate if needed
    this.checkRetention();
  }

  /**
   * Redact PII from data
   */
  private redactPII(data: any): any {
    const json = JSON.stringify(data);
    let redacted = json;

    for (const pattern of this.piiPatterns) {
      redacted = redacted.replace(pattern.pattern, pattern.replacement);
    }

    return JSON.parse(redacted);
  }

  /**
   * Detect PII fields
   */
  private detectPII(text: string): string[] {
    const detected: string[] = [];

    for (const pattern of this.piiPatterns) {
      if (pattern.pattern.test(text)) {
        detected.push(pattern.name);
      }
    }

    return detected;
  }

  /**
   * Generate hash for event
   */
  private generateHash(event: AuditEvent): string {
    const content = JSON.stringify({
      id: event.id,
      timestamp: event.timestamp,
      actor: event.actor,
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
    });

    return createHash('sha256').update(content).digest('hex');
  }

  /**
   * Generate HMAC signature for event
   *
   * Uses HMAC-SHA512 with the configured signing key for tamper-proof signatures.
   * The signing key must be provided from secure key management.
   */
  private generateSignature(event: AuditEvent): string {
    if (!this.signingKey) {
      throw Errors.internal('Cannot generate signature: signingKey not configured');
    }

    const content = event.hash || this.generateHash(event);

    // Use HMAC-SHA512 for proper message authentication
    return createHmac('sha512', this.signingKey).update(content).digest('hex');
  }

  /**
   * Encrypt event
   */
  private encryptEvent(event: AuditEvent): AuditEvent {
    if (!this.encryptionKey) return event;

    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);

    const sensitive = JSON.stringify(event.metadata || {});
    const encrypted = Buffer.concat([cipher.update(sensitive, 'utf8'), cipher.final()]);

    return {
      ...event,
      metadata: {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('base64'),
        tag: (cipher as any).getAuthTag().toString('base64'),
      },
    };
  }

  /**
   * Decrypt event
   */
  private decryptEvent(event: AuditEvent): AuditEvent {
    if (!this.encryptionKey || !event.metadata?.['encrypted']) return event;

    const decipher = createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(event.metadata['iv'], 'base64'));

    (decipher as any).setAuthTag(Buffer.from(event.metadata['tag'], 'base64'));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(event.metadata['encrypted'], 'base64')),
      decipher.final(),
    ]);

    return {
      ...event,
      metadata: JSON.parse(decrypted.toString('utf8')),
    };
  }

  /**
   * Check retention policy
   */
  private checkRetention(): void {
    const retentionMs = this.parseRetention(this.config.retention);
    const cutoff = Date.now() - retentionMs;

    const retained = this.events.filter((e) => e.timestamp > cutoff);
    const archived = this.events.filter((e) => e.timestamp <= cutoff);

    if (archived.length > 0) {
      this.archiveEvents(archived);
      this.events = retained;
    }
  }

  /**
   * Parse retention string
   */
  private parseRetention(retention: string): number {
    const match = retention.match(/^(\d+)([ymdh])$/);
    if (!match) throw Errors.notFound(`Invalid retention: ${retention}`);

    const [, value, unit] = match;
    const num = parseInt(value || '0', 10);

    switch (unit) {
      case 'y':
        return num * 365 * 24 * 60 * 60 * 1000;
      case 'm':
        return num * 30 * 24 * 60 * 60 * 1000;
      case 'd':
        return num * 24 * 60 * 60 * 1000;
      case 'h':
        return num * 60 * 60 * 1000;
      default:
        throw Errors.notFound(`Unknown retention unit: ${unit}`);
    }
  }

  /**
   * Archive events
   */
  private archiveEvents(events: AuditEvent[]): void {
    // In production, would write to archival storage
    this.emit('events:archived', { count: events.length });
  }

  /**
   * Query audit log
   */
  query(filter: {
    startTime?: number;
    endTime?: number;
    actor?: string;
    action?: string;
    resource?: string;
    outcome?: 'success' | 'failure';
  }): AuditEvent[] {
    return this.events.filter((event) => {
      if (filter.startTime && event.timestamp < filter.startTime) return false;
      if (filter.endTime && event.timestamp > filter.endTime) return false;
      if (filter.actor && event.actor.id !== filter.actor) return false;
      if (filter.action && event.action !== filter.action) return false;
      if (filter.resource && event.resource.id !== filter.resource) return false;
      if (filter.outcome && event.outcome !== filter.outcome) return false;
      return true;
    });
  }

  /**
   * Verify event integrity
   */
  verifyIntegrity(event: AuditEvent): boolean {
    if (!event.hash || !event.signature) return false;

    const expectedHash = this.generateHash(event);
    const expectedSignature = this.generateSignature(event);

    return event.hash === expectedHash && event.signature === expectedSignature;
  }

  /**
   * Export audit log
   */
  export(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      return this.exportCSV();
    }
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Export as CSV with proper escaping to prevent CSV injection attacks
   */
  private exportCSV(): string {
    const headers = ['id', 'timestamp', 'actor_id', 'action', 'resource_id', 'outcome'];
    const rows = this.events.map((e) => [
      this.escapeCSVValue(e.id),
      this.escapeCSVValue(new Date(e.timestamp).toISOString()),
      this.escapeCSVValue(e.actor.id),
      this.escapeCSVValue(e.action),
      this.escapeCSVValue(e.resource.id),
      this.escapeCSVValue(e.outcome),
    ]);

    return [headers.map((h) => this.escapeCSVValue(h)), ...rows].map((row) => row.join(',')).join('\n');
  }

  /**
   * Escape a CSV value to prevent injection attacks and handle special characters
   *
   * Rules:
   * 1. Values containing comma, quote, newline, or carriage return must be quoted
   * 2. Quotes within values must be doubled
   * 3. Values starting with =, +, -, @, Tab, or CR are prefixed with single quote (CSV injection prevention)
   */
  private escapeCSVValue(value: string | number | boolean | null | undefined): string {
    if (value === null || value === undefined) {
      return '';
    }

    const stringValue = String(value);

    // CSV injection prevention: prefix potentially dangerous values
    // These characters can be interpreted as formulas by spreadsheet applications
    const dangerousChars = ['=', '+', '-', '@', '\t', '\r'];
    const startsWithDangerous = dangerousChars.some((char) => stringValue.startsWith(char));

    // Check if value needs quoting
    const needsQuoting = /[",\n\r]/.test(stringValue) || startsWithDangerous;

    if (needsQuoting) {
      // Double any existing quotes and wrap in quotes
      const escaped = stringValue.replace(/"/g, '""');
      // If it starts with a dangerous character, prefix with single quote inside the quotes
      if (startsWithDangerous) {
        return `"'${escaped}"`;
      }
      return `"${escaped}"`;
    }

    return stringValue;
  }
}

/**
 * Compliance Manager
 */
export class ComplianceManager extends EventEmitter {
  private auditLogger: AuditLogger;
  private dataInventory = new Map<string, DataInventoryItem>();
  private consentRecords = new Map<string, ConsentRecord>();
  private dataSubjects = new Map<string, DataSubject>();

  constructor(
    private config: {
      standards: ComplianceStandard[];
      auditConfig: AuditConfig;
    }
  ) {
    super();
    this.auditLogger = new AuditLogger(config.auditConfig);
    this.initializeStandards();
  }

  /**
   * Initialize compliance standards
   */
  private initializeStandards(): void {
    for (const standard of this.config.standards) {
      this.applyStandard(standard);
    }
  }

  /**
   * Apply compliance standard
   */
  private applyStandard(standard: ComplianceStandard): void {
    switch (standard) {
      case ComplianceStandard.GDPR:
        this.applyGDPR();
        break;
      case ComplianceStandard.HIPAA:
        this.applyHIPAA();
        break;
      case ComplianceStandard.SOC2:
        this.applySOC2();
        break;
      case ComplianceStandard.PCI_DSS:
        this.applyPCIDSS();
        break;
      default:
        // Unknown standard, log warning but don't fail
        this.emit('standard:unknown', { standard });
        break;
    }
  }

  /**
   * Apply GDPR compliance
   */
  private applyGDPR(): void {
    // GDPR-specific configuration
    this.emit('standard:applied', { standard: 'GDPR' });
  }

  /**
   * Apply HIPAA compliance
   */
  private applyHIPAA(): void {
    // HIPAA-specific configuration
    this.emit('standard:applied', { standard: 'HIPAA' });
  }

  /**
   * Apply SOC2 compliance
   */
  private applySOC2(): void {
    // SOC2-specific configuration
    this.emit('standard:applied', { standard: 'SOC2' });
  }

  /**
   * Apply PCI-DSS compliance
   */
  private applyPCIDSS(): void {
    // PCI-DSS-specific configuration
    this.emit('standard:applied', { standard: 'PCI-DSS' });
  }

  /**
   * Validate data subject request input
   */
  private validateDataSubjectRequest(request: DataSubjectRequest): void {
    // Validate request ID
    if (!request.id || typeof request.id !== 'string' || request.id.length > 255) {
      throw Errors.badRequest('Invalid request ID: must be a non-empty string up to 255 characters', { field: 'id' });
    }

    // Validate subject ID (prevent injection and ensure reasonable format)
    if (!request.subjectId || typeof request.subjectId !== 'string') {
      throw Errors.badRequest('Invalid subject ID: must be a non-empty string', { field: 'subjectId' });
    }
    if (request.subjectId.length > 255) {
      throw Errors.badRequest('Subject ID too long: maximum 255 characters', { field: 'subjectId' });
    }
    // Basic sanitization - allow alphanumeric, dash, underscore, email-like formats
    if (!/^[a-zA-Z0-9@._-]+$/.test(request.subjectId)) {
      throw Errors.badRequest('Subject ID contains invalid characters', { field: 'subjectId' });
    }

    // Validate request type
    const validTypes = ['access', 'rectification', 'erasure', 'portability', 'restriction'];
    if (!validTypes.includes(request.type)) {
      throw Errors.badRequest(`Invalid request type: ${request.type}`, { field: 'type' });
    }

    // Validate corrections if present
    if (request.corrections !== undefined && request.corrections !== null) {
      if (typeof request.corrections !== 'object') {
        throw Errors.badRequest('Corrections must be an object', { field: 'corrections' });
      }
      // Limit corrections size to prevent abuse
      const correctionsJson = JSON.stringify(request.corrections);
      if (correctionsJson.length > 100000) {
        throw Errors.badRequest('Corrections payload too large: maximum 100KB', { field: 'corrections' });
      }
    }

    // Validate format if present
    if (request.format !== undefined) {
      const validFormats = ['json', 'csv', 'xml'];
      if (!validFormats.includes(request.format)) {
        throw Errors.badRequest(`Invalid export format: ${request.format}`, { field: 'format' });
      }
    }
  }

  /**
   * Process data subject request
   */
  async processDataSubjectRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    // Validate input before processing
    this.validateDataSubjectRequest(request);

    this.auditLogger.log({
      actor: { type: 'user', id: request.subjectId },
      action: `data-subject-request:${request.type}`,
      resource: { type: 'personal-data', id: request.subjectId },
      outcome: 'success',
      metadata: { requestType: request.type },
    });

    switch (request.type) {
      case 'access':
        return this.handleAccessRequest(request);
      case 'rectification':
        return this.handleRectificationRequest(request);
      case 'erasure':
        return this.handleErasureRequest(request);
      case 'portability':
        return this.handlePortabilityRequest(request);
      case 'restriction':
        return this.handleRestrictionRequest(request);
      default:
        // This should never happen due to validation above, but TypeScript needs it
        throw Errors.badRequest('Invalid request type', { field: 'type' });
    }
  }

  /**
   * Handle access request
   */
  private async handleAccessRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    const subject = this.dataSubjects.get(request.subjectId);
    if (!subject) {
      return {
        requestId: request.id,
        status: 'completed',
        data: null,
        message: 'No data found for subject',
      };
    }

    return {
      requestId: request.id,
      status: 'completed',
      data: this.sanitizeSubjectData(subject),
      message: 'Data access granted',
    };
  }

  /**
   * Handle rectification request
   */
  private async handleRectificationRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    const subject = this.dataSubjects.get(request.subjectId);
    if (!subject) {
      return {
        requestId: request.id,
        status: 'failed',
        message: 'Subject not found',
      };
    }

    // Apply corrections
    if (request.corrections) {
      Object.assign(subject.data, request.corrections);
      this.dataSubjects.set(request.subjectId, subject);
    }

    return {
      requestId: request.id,
      status: 'completed',
      message: 'Data rectified successfully',
    };
  }

  /**
   * Handle erasure request (Right to be Forgotten)
   */
  private async handleErasureRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    // Orchestrate data deletion across all systems
    const systems = this.getSystemsWithSubjectData(request.subjectId);

    const deletionResults = await Promise.all(
      systems.map((system) => this.deleteFromSystem(system, request.subjectId))
    );

    // Remove from local storage
    this.dataSubjects.delete(request.subjectId);
    this.consentRecords.delete(request.subjectId);

    return {
      requestId: request.id,
      status: 'completed',
      message: 'Data erased successfully',
      metadata: {
        systemsProcessed: systems.length,
        deletionResults,
      },
    };
  }

  /**
   * Handle portability request
   */
  private async handlePortabilityRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    const subject = this.dataSubjects.get(request.subjectId);
    if (!subject) {
      return {
        requestId: request.id,
        status: 'failed',
        message: 'Subject not found',
      };
    }

    const portableData = {
      subject: this.sanitizeSubjectData(subject),
      consent: this.consentRecords.get(request.subjectId),
      exportedAt: new Date().toISOString(),
      format: request.format || 'json',
    };

    return {
      requestId: request.id,
      status: 'completed',
      data: portableData,
      message: 'Data exported successfully',
    };
  }

  /**
   * Handle restriction request
   */
  private async handleRestrictionRequest(request: DataSubjectRequest): Promise<DataSubjectResponse> {
    const subject = this.dataSubjects.get(request.subjectId);
    if (!subject) {
      return {
        requestId: request.id,
        status: 'failed',
        message: 'Subject not found',
      };
    }

    subject.restricted = true;
    subject.restrictionReason = request.reason;
    this.dataSubjects.set(request.subjectId, subject);

    return {
      requestId: request.id,
      status: 'completed',
      message: 'Processing restricted successfully',
    };
  }

  /**
   * Record consent
   */
  recordConsent(consent: ConsentRecord): void {
    this.consentRecords.set(consent.subjectId, consent);
    this.auditLogger.log({
      actor: { type: 'user', id: consent.subjectId },
      action: 'consent:recorded',
      resource: { type: 'consent', id: consent.id },
      outcome: 'success',
      metadata: { purposes: consent.purposes },
    });
  }

  /**
   * Verify consent
   */
  verifyConsent(subjectId: string, purpose: string): boolean {
    const consent = this.consentRecords.get(subjectId);
    if (!consent) return false;

    return consent.purposes.includes(purpose) && (!consent.expiresAt || consent.expiresAt > Date.now());
  }

  /**
   * Register data inventory item
   */
  registerDataInventory(item: DataInventoryItem): void {
    this.dataInventory.set(item.id, item);
    this.emit('inventory:registered', item);
  }

  /**
   * Get systems with subject data
   */
  private getSystemsWithSubjectData(subjectId: string): string[] {
    // In production, would query actual systems
    return ['database', 'cache', 'logs', 'backups'];
  }

  /**
   * Delete from system
   */
  private async deleteFromSystem(system: string, subjectId: string): Promise<boolean> {
    // In production, would actually delete from system
    return true;
  }

  /**
   * Sanitize subject data
   */
  private sanitizeSubjectData(subject: DataSubject): any {
    const { data, ...metadata } = subject;
    return {
      ...metadata,
      data: this.auditLogger['redactPII'](data),
    };
  }

  /**
   * Generate compliance report
   */
  generateComplianceReport(): ComplianceReport {
    return {
      timestamp: new Date().toISOString(),
      standards: this.config.standards,
      dataSubjects: this.dataSubjects.size,
      consentRecords: this.consentRecords.size,
      dataInventory: this.dataInventory.size,
      auditEvents: this.auditLogger.query({}).length,
      compliance: this.assessCompliance(),
    };
  }

  /**
   * Assess compliance status based on actual configuration and data
   *
   * NOTE: This is a basic self-assessment based on configuration state.
   * For production compliance certification, use a certified compliance assessment tool
   * or engage a qualified auditor.
   */
  private assessCompliance(): Record<string, ComplianceAssessment> {
    const assessments: Record<string, ComplianceAssessment> = {};

    for (const standard of this.config.standards) {
      assessments[standard] = this.assessStandard(standard);
    }

    return assessments;
  }

  /**
   * Assess a specific compliance standard
   */
  private assessStandard(standard: ComplianceStandard): ComplianceAssessment {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;
    const maxScore = 100;

    // Common checks for all standards
    const commonChecks = this.performCommonChecks();
    gaps.push(...commonChecks.gaps);
    recommendations.push(...commonChecks.recommendations);
    score += commonChecks.score;

    // Standard-specific checks
    switch (standard) {
      case ComplianceStandard.GDPR:
        const gdprChecks = this.assessGDPRCompliance();
        gaps.push(...gdprChecks.gaps);
        recommendations.push(...gdprChecks.recommendations);
        score += gdprChecks.score;
        break;

      case ComplianceStandard.HIPAA:
        const hipaaChecks = this.assessHIPAACompliance();
        gaps.push(...hipaaChecks.gaps);
        recommendations.push(...hipaaChecks.recommendations);
        score += hipaaChecks.score;
        break;

      case ComplianceStandard.SOC2:
        const soc2Checks = this.assessSOC2Compliance();
        gaps.push(...soc2Checks.gaps);
        recommendations.push(...soc2Checks.recommendations);
        score += soc2Checks.score;
        break;

      case ComplianceStandard.PCI_DSS:
        const pciChecks = this.assessPCIDSSCompliance();
        gaps.push(...pciChecks.gaps);
        recommendations.push(...pciChecks.recommendations);
        score += pciChecks.score;
        break;

      default:
        // Unknown standard - add generic warning
        gaps.push(`No specific assessment available for ${standard}`);
        recommendations.push('Engage a qualified auditor for compliance assessment');
        score += 20; // Base score for having audit logging enabled
        break;
    }

    // Normalize score to 0-100
    const normalizedScore = Math.min(Math.max(score, 0), maxScore);

    return {
      compliant: normalizedScore >= 70 && gaps.length === 0,
      score: normalizedScore,
      gaps,
      recommendations,
    };
  }

  /**
   * Perform checks common to all compliance standards
   */
  private performCommonChecks(): { gaps: string[]; recommendations: string[]; score: number } {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    // Check audit logging configuration
    if (this.config.auditConfig.level === 'none') {
      gaps.push('Audit logging is disabled');
      recommendations.push('Enable audit logging at minimum "standard" level');
    } else {
      score += 15;
      if (this.config.auditConfig.level === 'full') {
        score += 5;
      }
    }

    // Check immutability (tamper-proof logs)
    if (!this.config.auditConfig.immutable) {
      gaps.push('Audit logs are not immutable (tamper-proof)');
      recommendations.push('Enable immutable audit logging with digital signatures');
    } else {
      score += 15;
    }

    // Check encryption
    if (!this.config.auditConfig.encryption) {
      gaps.push('Audit data is not encrypted at rest');
      recommendations.push('Enable encryption for sensitive audit data');
    } else {
      score += 10;
    }

    // Check PII redaction
    if (!this.config.auditConfig.redactPII) {
      recommendations.push('Consider enabling PII redaction for enhanced privacy');
    } else {
      score += 5;
    }

    // Check persistent storage
    const storageType = this.config.auditConfig.storage?.type;
    if (!storageType || storageType === 'memory') {
      gaps.push('Audit logs are stored in-memory only and will be lost on restart');
      recommendations.push('Configure persistent storage (database, S3, or file-based)');
    } else {
      score += 10;
    }

    return { gaps, recommendations, score };
  }

  /**
   * GDPR-specific compliance checks
   */
  private assessGDPRCompliance(): { gaps: string[]; recommendations: string[]; score: number } {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    // Check if consent records are being tracked
    if (this.consentRecords.size > 0) {
      score += 10;
    } else {
      recommendations.push('Record consent for all data processing activities');
    }

    // Check if data subject rights are implemented (we have the methods)
    score += 15; // Credit for having DSR handling methods

    // Check data inventory
    if (this.dataInventory.size > 0) {
      score += 10;
    } else {
      recommendations.push('Maintain a data inventory (Article 30 GDPR)');
    }

    // Check retention policy
    if (this.config.auditConfig.retention) {
      score += 5;
    } else {
      gaps.push('No retention policy configured');
      recommendations.push('Define data retention periods');
    }

    return { gaps, recommendations, score };
  }

  /**
   * HIPAA-specific compliance checks
   */
  private assessHIPAACompliance(): { gaps: string[]; recommendations: string[]; score: number } {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    // HIPAA requires encryption
    if (this.config.auditConfig.encryption) {
      score += 15;
    } else {
      gaps.push('HIPAA requires encryption of PHI');
    }

    // HIPAA requires audit trails
    if (this.config.auditConfig.level !== 'none') {
      score += 15;
    } else {
      gaps.push('HIPAA requires audit trails for all access to PHI');
    }

    // 6-year retention requirement
    const retention = this.config.auditConfig.retention;
    if (retention && this.parseRetentionYears(retention) >= 6) {
      score += 10;
    } else {
      gaps.push('HIPAA requires 6-year retention of audit logs');
      recommendations.push('Set retention to at least 6 years ("6y")');
    }

    return { gaps, recommendations, score };
  }

  /**
   * SOC2-specific compliance checks
   */
  private assessSOC2Compliance(): { gaps: string[]; recommendations: string[]; score: number } {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    // SOC2 requires comprehensive logging
    if (this.config.auditConfig.level === 'full') {
      score += 15;
    } else if (this.config.auditConfig.level === 'standard') {
      score += 10;
      recommendations.push('Consider "full" audit level for SOC2');
    } else {
      gaps.push('SOC2 requires comprehensive audit logging');
    }

    // Immutability is important for SOC2
    if (this.config.auditConfig.immutable) {
      score += 15;
    } else {
      recommendations.push('Enable immutable logging for stronger SOC2 controls');
    }

    // Change tracking
    score += 10; // Credit for having change tracking in audit events

    return { gaps, recommendations, score };
  }

  /**
   * PCI-DSS specific compliance checks
   */
  private assessPCIDSSCompliance(): { gaps: string[]; recommendations: string[]; score: number } {
    const gaps: string[] = [];
    const recommendations: string[] = [];
    let score = 0;

    // PCI-DSS requires 1-year retention minimum
    const retention = this.config.auditConfig.retention;
    if (retention && this.parseRetentionYears(retention) >= 1) {
      score += 10;
    } else {
      gaps.push('PCI-DSS requires at least 1-year log retention');
    }

    // PCI-DSS requires audit trails
    if (this.config.auditConfig.level !== 'none' && this.config.auditConfig.level !== 'minimal') {
      score += 15;
    } else {
      gaps.push('PCI-DSS requires detailed audit trails');
    }

    // Encryption is required
    if (this.config.auditConfig.encryption) {
      score += 15;
    } else {
      gaps.push('PCI-DSS requires encryption of cardholder data');
    }

    return { gaps, recommendations, score };
  }

  /**
   * Parse retention string to years
   */
  private parseRetentionYears(retention: string): number {
    const match = retention.match(/^(\d+)([ymdh])$/);
    if (!match) return 0;

    const [, value, unit] = match;
    const num = parseInt(value || '0', 10);

    switch (unit) {
      case 'y':
        return num;
      case 'm':
        return num / 12;
      case 'd':
        return num / 365;
      case 'h':
        return num / (365 * 24);
      default:
        return 0;
    }
  }
}

/**
 * Data Inventory Item
 */
export interface DataInventoryItem {
  id: string;
  name: string;
  classification: DataClassification;
  location: string;
  owner: string;
  retention: string;
  pii: boolean;
  encrypted: boolean;
}

/**
 * Consent Record
 */
export interface ConsentRecord {
  id: string;
  subjectId: string;
  purposes: string[];
  grantedAt: number;
  expiresAt?: number;
  withdrawn?: boolean;
}

/**
 * Data Subject
 */
export interface DataSubject {
  id: string;
  data: any;
  createdAt: number;
  updatedAt: number;
  restricted?: boolean;
  restrictionReason?: string;
}

/**
 * Data Subject Request
 */
export interface DataSubjectRequest {
  id: string;
  subjectId: string;
  type: 'access' | 'rectification' | 'erasure' | 'portability' | 'restriction';
  reason?: string;
  corrections?: any;
  format?: string;
}

/**
 * Data Subject Response
 */
export interface DataSubjectResponse {
  requestId: string;
  status: 'completed' | 'pending' | 'failed';
  data?: any;
  message?: string;
  metadata?: any;
}

/**
 * Compliance Report
 */
export interface ComplianceReport {
  timestamp: string;
  standards: ComplianceStandard[];
  dataSubjects: number;
  consentRecords: number;
  dataInventory: number;
  auditEvents: number;
  compliance: Record<string, ComplianceAssessment>;
}

/**
 * Compliance Assessment
 */
export interface ComplianceAssessment {
  compliant: boolean;
  score: number;
  gaps: string[];
  recommendations: string[];
}
