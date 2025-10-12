/**
 * Compliance and Audit Tests
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  AuditLogger,
  ComplianceManager,
  ComplianceStandard,
  DataClassification,
  type AuditEvent,
  type AuditConfig,
} from '../../../../src/modules/pm/enterprise/compliance.js';

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  const config: AuditConfig = {
    level: 'full',
    retention: '7d',
    encryption: false,
    immutable: true,
    redactPII: true,
    standards: [ComplianceStandard.GDPR, ComplianceStandard.SOC2],
  };

  beforeEach(() => {
    auditLogger = new AuditLogger(config);
  });

  describe('Event Logging', () => {
    it('should log audit events with proper structure', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'data.access',
        resource: { type: 'document', id: 'doc456' },
        outcome: 'success',
      });

      expect(eventLogged).toHaveBeenCalledWith(
        expect.objectContaining({
          id: expect.any(String),
          timestamp: expect.any(Number),
          actor: expect.objectContaining({ type: 'user', id: 'user123' }),
          action: 'data.access',
          resource: expect.objectContaining({ type: 'document', id: 'doc456' }),
          outcome: 'success',
        })
      );
    });

    it('should add hash and signature when immutable', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'system', id: 'system' },
        action: 'startup',
        resource: { type: 'service', id: 'main' },
        outcome: 'success',
      });

      expect(eventLogged).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: expect.any(String),
          signature: expect.any(String),
        })
      );
    });
  });

  describe('PII Redaction', () => {
    it('should redact SSN', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'data.update',
        resource: { type: 'profile', id: 'profile456' },
        outcome: 'success',
        pii: true,
        metadata: { ssn: '123-45-6789' },
      });

      expect(eventLogged).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ ssn: '***-**-****' }),
          redacted: expect.arrayContaining(['ssn']),
        })
      );
    });

    it('should redact credit card numbers', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'payment.process',
        resource: { type: 'transaction', id: 'tx789' },
        outcome: 'success',
        pii: true,
        metadata: { card: '4111-1111-1111-1111' },
      });

      expect(eventLogged).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ card: '****-****-****-****' }),
          redacted: expect.arrayContaining(['creditCard']),
        })
      );
    });

    it('should redact email addresses', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'account.create',
        resource: { type: 'account', id: 'acc123' },
        outcome: 'success',
        pii: true,
        metadata: { email: 'user@example.com' },
      });

      expect(eventLogged).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: expect.objectContaining({ email: '***@***.***' }),
          redacted: expect.arrayContaining(['email']),
        })
      );
    });
  });

  describe('Query Functionality', () => {
    beforeEach(() => {
      // Log some test events
      auditLogger.log({
        actor: { type: 'user', id: 'user1' },
        action: 'login',
        resource: { type: 'system', id: 'auth' },
        outcome: 'success',
      });

      auditLogger.log({
        actor: { type: 'user', id: 'user2' },
        action: 'login',
        resource: { type: 'system', id: 'auth' },
        outcome: 'failure',
      });

      auditLogger.log({
        actor: { type: 'user', id: 'user1' },
        action: 'logout',
        resource: { type: 'system', id: 'auth' },
        outcome: 'success',
      });
    });

    it('should query by actor', () => {
      const results = auditLogger.query({ actor: 'user1' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.actor.id === 'user1')).toBe(true);
    });

    it('should query by action', () => {
      const results = auditLogger.query({ action: 'login' });
      expect(results).toHaveLength(2);
      expect(results.every((e) => e.action === 'login')).toBe(true);
    });

    it('should query by outcome', () => {
      const results = auditLogger.query({ outcome: 'failure' });
      expect(results).toHaveLength(1);
      expect(results[0]?.outcome).toBe('failure');
    });

    it('should query by time range', () => {
      const now = Date.now();
      const results = auditLogger.query({
        startTime: now - 60000,
        endTime: now + 60000,
      });
      expect(results.length).toBeGreaterThan(0);
    });
  });

  describe('Integrity Verification', () => {
    it('should verify event integrity', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'test',
        resource: { type: 'test', id: 'test' },
        outcome: 'success',
      });

      const event = eventLogged.mock.calls[0]?.[0] as AuditEvent;
      expect(auditLogger.verifyIntegrity(event)).toBe(true);
    });

    it('should detect tampered events', () => {
      const eventLogged = jest.fn();
      auditLogger.on('event:logged', eventLogged);

      auditLogger.log({
        actor: { type: 'user', id: 'user123' },
        action: 'test',
        resource: { type: 'test', id: 'test' },
        outcome: 'success',
      });

      const event = eventLogged.mock.calls[0]?.[0] as AuditEvent;
      // Tamper with the event
      event.actor.id = 'hacker';

      expect(auditLogger.verifyIntegrity(event)).toBe(false);
    });
  });

  describe('Export Functionality', () => {
    beforeEach(() => {
      auditLogger.log({
        actor: { type: 'user', id: 'user1' },
        action: 'test',
        resource: { type: 'test', id: 'test1' },
        outcome: 'success',
      });
    });

    it('should export as JSON', () => {
      const json = auditLogger.export('json');
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });

    it('should export as CSV', () => {
      const csv = auditLogger.export('csv');
      const lines = csv.split('\n');
      expect(lines.length).toBeGreaterThan(1);
      expect(lines[0]).toContain('id,timestamp,actor_id,action,resource_id,outcome');
    });
  });
});

describe('ComplianceManager', () => {
  let complianceManager: ComplianceManager;

  beforeEach(() => {
    complianceManager = new ComplianceManager({
      standards: [ComplianceStandard.GDPR, ComplianceStandard.HIPAA],
      auditConfig: {
        level: 'full',
        retention: '7y',
        encryption: true,
        immutable: true,
        redactPII: true,
        standards: [ComplianceStandard.GDPR],
      },
    });
  });

  describe('Standards Application', () => {
    it('should apply GDPR standard', () => {
      const standardApplied = jest.fn();

      // Create a spy for the emit method before creating the manager
      const originalEmit = ComplianceManager.prototype.emit;
      ComplianceManager.prototype.emit = jest.fn(function (this: any, event: string, ...args: any[]) {
        if (event === 'standard:applied') {
          standardApplied(...args);
        }
        return originalEmit.call(this, event, ...args);
      });

      // Re-initialize to trigger standard application
      const manager = new ComplianceManager({
        standards: [ComplianceStandard.GDPR],
        auditConfig: {
          level: 'full',
          retention: '7y',
          encryption: false,
          immutable: true,
          redactPII: true,
          standards: [ComplianceStandard.GDPR],
        },
      });

      // Standards are applied during initialization
      expect(standardApplied).toHaveBeenCalledWith({ standard: 'GDPR' });

      // Restore original emit
      ComplianceManager.prototype.emit = originalEmit;
    });
  });

  describe('Data Subject Requests', () => {
    it('should handle access request', async () => {
      const response = await complianceManager.processDataSubjectRequest({
        id: 'req123',
        subjectId: 'user123',
        type: 'access',
      });

      expect(response).toMatchObject({
        requestId: 'req123',
        status: expect.stringMatching(/completed|failed/),
        message: expect.any(String),
      });
    });

    it('should handle erasure request', async () => {
      const response = await complianceManager.processDataSubjectRequest({
        id: 'req124',
        subjectId: 'user123',
        type: 'erasure',
      });

      expect(response).toMatchObject({
        requestId: 'req124',
        status: 'completed',
        message: 'Data erased successfully',
        metadata: expect.objectContaining({
          systemsProcessed: expect.any(Number),
        }),
      });
    });

    it('should handle rectification request', async () => {
      const response = await complianceManager.processDataSubjectRequest({
        id: 'req125',
        subjectId: 'user123',
        type: 'rectification',
        corrections: { name: 'Updated Name' },
      });

      expect(response).toMatchObject({
        requestId: 'req125',
        status: expect.stringMatching(/completed|failed/),
        message: expect.any(String),
      });
    });

    it('should handle portability request', async () => {
      const response = await complianceManager.processDataSubjectRequest({
        id: 'req126',
        subjectId: 'user123',
        type: 'portability',
        format: 'json',
      });

      expect(response).toMatchObject({
        requestId: 'req126',
        status: expect.stringMatching(/completed|failed/),
      });
    });

    it('should handle restriction request', async () => {
      const response = await complianceManager.processDataSubjectRequest({
        id: 'req127',
        subjectId: 'user123',
        type: 'restriction',
        reason: 'Legal hold',
      });

      expect(response).toMatchObject({
        requestId: 'req127',
        status: expect.stringMatching(/completed|failed/),
      });
    });
  });

  describe('Consent Management', () => {
    it('should record consent', () => {
      complianceManager.recordConsent({
        id: 'consent123',
        subjectId: 'user123',
        purposes: ['marketing', 'analytics'],
        grantedAt: Date.now(),
      });

      const hasConsent = complianceManager.verifyConsent('user123', 'marketing');
      expect(hasConsent).toBe(true);
    });

    it('should verify consent for specific purpose', () => {
      complianceManager.recordConsent({
        id: 'consent124',
        subjectId: 'user124',
        purposes: ['analytics'],
        grantedAt: Date.now(),
      });

      expect(complianceManager.verifyConsent('user124', 'analytics')).toBe(true);
      expect(complianceManager.verifyConsent('user124', 'marketing')).toBe(false);
    });

    it('should handle expired consent', () => {
      complianceManager.recordConsent({
        id: 'consent125',
        subjectId: 'user125',
        purposes: ['marketing'],
        grantedAt: Date.now() - 100000,
        expiresAt: Date.now() - 1000, // Expired
      });

      expect(complianceManager.verifyConsent('user125', 'marketing')).toBe(false);
    });
  });

  describe('Data Inventory', () => {
    it('should register data inventory items', () => {
      const inventoryRegistered = jest.fn();
      complianceManager.on('inventory:registered', inventoryRegistered);

      complianceManager.registerDataInventory({
        id: 'inv123',
        name: 'User Database',
        classification: DataClassification.CONFIDENTIAL,
        location: 'primary-db',
        owner: 'data-team',
        retention: '3y',
        pii: true,
        encrypted: true,
      });

      expect(inventoryRegistered).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'inv123',
          name: 'User Database',
          classification: DataClassification.CONFIDENTIAL,
        })
      );
    });
  });

  describe('Compliance Reporting', () => {
    it('should generate compliance report', () => {
      const report = complianceManager.generateComplianceReport();

      expect(report).toMatchObject({
        timestamp: expect.any(String),
        standards: expect.arrayContaining([ComplianceStandard.GDPR, ComplianceStandard.HIPAA]),
        dataSubjects: expect.any(Number),
        consentRecords: expect.any(Number),
        dataInventory: expect.any(Number),
        auditEvents: expect.any(Number),
        compliance: expect.objectContaining({
          [ComplianceStandard.GDPR]: expect.objectContaining({
            compliant: expect.any(Boolean),
            score: expect.any(Number),
            gaps: expect.any(Array),
            recommendations: expect.any(Array),
          }),
        }),
      });
    });

    it('should assess compliance for each standard', () => {
      const report = complianceManager.generateComplianceReport();

      // Check GDPR compliance assessment
      expect(report.compliance[ComplianceStandard.GDPR]).toBeDefined();
      expect(report.compliance[ComplianceStandard.GDPR]?.score).toBeGreaterThanOrEqual(95);
      expect(report.compliance[ComplianceStandard.GDPR]?.score).toBeLessThanOrEqual(100);

      // Check HIPAA compliance assessment
      expect(report.compliance[ComplianceStandard.HIPAA]).toBeDefined();
      expect(report.compliance[ComplianceStandard.HIPAA]?.score).toBeGreaterThanOrEqual(95);
      expect(report.compliance[ComplianceStandard.HIPAA]?.score).toBeLessThanOrEqual(100);
    });
  });
});

describe('Encryption and Security', () => {
  it('should encrypt sensitive metadata when configured', () => {
    const auditLogger = new AuditLogger({
      level: 'full',
      retention: '30d',
      encryption: true,
      immutable: false,
      redactPII: false,
      standards: [],
    });

    const eventLogged = jest.fn();
    auditLogger.on('event:logged', eventLogged);

    auditLogger.log({
      actor: { type: 'user', id: 'user123' },
      action: 'sensitive.access',
      resource: { type: 'secret', id: 'secret456' },
      outcome: 'success',
      metadata: { secret: 'confidential-data' },
    });

    const event = eventLogged.mock.calls[0]?.[0] as AuditEvent;

    // When encryption is enabled, metadata should be encrypted
    expect(event.metadata).toMatchObject({
      encrypted: expect.any(String),
      iv: expect.any(String),
      tag: expect.any(String),
    });
  });
});

describe('Data Classification', () => {
  it('should handle all classification levels', () => {
    const levels = [
      DataClassification.PUBLIC,
      DataClassification.INTERNAL,
      DataClassification.CONFIDENTIAL,
      DataClassification.RESTRICTED,
    ];

    const complianceManager = new ComplianceManager({
      standards: [ComplianceStandard.SOC2],
      auditConfig: {
        level: 'standard',
        retention: '1y',
        encryption: false,
        immutable: false,
        redactPII: false,
        standards: [ComplianceStandard.SOC2],
      },
    });

    levels.forEach((classification) => {
      complianceManager.registerDataInventory({
        id: `item-${classification}`,
        name: `Test ${classification}`,
        classification,
        location: 'test',
        owner: 'test',
        retention: '1y',
        pii: false,
        encrypted: false,
      });
    });

    const report = complianceManager.generateComplianceReport();
    expect(report.dataInventory).toBe(4);
  });
});
