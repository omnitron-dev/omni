/**
 * Event Metadata Service
 * 
 * Manages event metadata and context for events
 */

import type { EventMetadata } from '@omnitron-dev/eventemitter';

import { Injectable } from '@omnitron-dev/nexus';

/**
 * Service for managing event metadata
 */
@Injectable()
export class EventMetadataService {
  private correlationIdCounter = 0;
  private defaultMetadata: Partial<EventMetadata> = {};

  /**
   * Set default metadata for all events
   */
  setDefaultMetadata(metadata: Partial<EventMetadata>): void {
    this.defaultMetadata = { ...this.defaultMetadata, ...metadata };
  }

  /**
   * Create metadata object for an event
   */
  createMetadata(partial?: Partial<EventMetadata>): EventMetadata {
    return {
      id: this.generateEventId(),
      timestamp: Date.now(),
      correlationId: this.generateCorrelationId(),
      ...this.defaultMetadata,
      ...partial
    } as EventMetadata;
  }

  /**
   * Generate unique event ID
   */
  generateEventId(): string {
    return `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Generate correlation ID for tracing
   */
  generateCorrelationId(): string {
    this.correlationIdCounter++;
    return `cor_${Date.now()}_${this.correlationIdCounter}_${Math.random().toString(36).substr(2, 5)}`;
  }

  /**
   * Extract metadata from context
   */
  extractFromContext(context: any): Partial<EventMetadata> {
    const metadata: Partial<EventMetadata> = {};

    if (context.userId) metadata.userId = context.userId;
    if (context.sessionId) metadata.sessionId = context.sessionId;
    if (context.correlationId) metadata.correlationId = context.correlationId;
    if (context.source) metadata.source = context.source;
    if (context.tags) metadata.tags = context.tags;
    if (context.priority) metadata.priority = context.priority;

    return metadata;
  }

  /**
   * Merge metadata objects
   */
  mergeMetadata(...metadatas: Partial<EventMetadata>[]): EventMetadata {
    const merged = metadatas.reduce(
      (acc, metadata) => ({ ...acc, ...metadata }),
      {}
    );

    // Ensure required fields
    if (!merged.id) merged.id = this.generateEventId();
    if (!merged.timestamp) merged.timestamp = Date.now();

    return merged as EventMetadata;
  }

  /**
   * Validate metadata
   */
  validateMetadata(metadata: any): boolean {
    if (!metadata) return false;
    if (typeof metadata !== 'object') return false;
    if (!metadata.id || typeof metadata.id !== 'string') return false;
    if (!metadata.timestamp || typeof metadata.timestamp !== 'number') return false;

    return true;
  }

  /**
   * Add tags to metadata
   */
  addTags(metadata: EventMetadata, ...tags: string[]): EventMetadata {
    const existingTags = metadata.tags || [];
    const uniqueTags = [...new Set([...existingTags, ...tags])];

    return {
      ...metadata,
      tags: uniqueTags
    };
  }

  /**
   * Set TTL for metadata
   */
  setTTL(metadata: EventMetadata, ttl: number): EventMetadata {
    return {
      ...metadata,
      ttl,
      expiresAt: Date.now() + ttl
    };
  }

  /**
   * Check if metadata has expired
   */
  isExpired(metadata: EventMetadata): boolean {
    if (!metadata['expiresAt']) return false;
    return Date.now() > metadata['expiresAt'];
  }

  /**
   * Sanitize metadata for logging
   */
  sanitizeForLogging(metadata: EventMetadata): any {
    const sanitized = { ...metadata };

    // Remove sensitive fields
    delete sanitized.userId;
    delete sanitized.sessionId;

    // Mask any potential sensitive data
    if (sanitized['user']) {
      sanitized['user'] = '***';
    }

    return sanitized;
  }

  /**
   * Create child metadata for nested events
   */
  createChildMetadata(
    parent: EventMetadata,
    partial?: Partial<EventMetadata>
  ): EventMetadata {
    return {
      ...parent,
      ...partial,
      id: this.generateEventId(),
      timestamp: Date.now(),
      parentId: parent.id,
      correlationId: parent.correlationId // Keep same correlation ID
    } as EventMetadata;
  }
}