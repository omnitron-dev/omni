/**
 * Tests for EventMetadataService
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import 'reflect-metadata';
import { EventMetadataService } from '../../../src/modules/events/event-metadata.service';

describe('EventMetadataService', () => {
  let metadataService: EventMetadataService;
  let mockEmitter: any;

  beforeEach(() => {
    mockEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      eventNames: jest.fn().mockReturnValue([])
    };

    metadataService = new EventMetadataService(mockEmitter);
  });

  it('should store and retrieve metadata', () => {
    metadataService.setMetadata('test.event', {
      description: 'Test event',
      schema: { type: 'object' }
    });

    const metadata = metadataService.getMetadata('test.event');
    expect(metadata.description).toBe('Test event');
    expect(metadata.schema).toEqual({ type: 'object' });
  });

  it('should validate event data against schema', () => {
    metadataService.setMetadata('validated.event', {
      schema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        },
        required: ['name']
      }
    });

    const valid = metadataService.validate('validated.event', { name: 'John', age: 30 });
    expect(valid).toBe(true);

    const invalid = metadataService.validate('validated.event', { age: 30 });
    expect(invalid).toBe(false);
  });

  it('should list all registered events', () => {
    metadataService.setMetadata('event1', {});
    metadataService.setMetadata('event2', {});
    metadataService.setMetadata('event3', {});

    const events = metadataService.getAllEvents();
    expect(events).toContain('event1');
    expect(events).toContain('event2');
    expect(events).toContain('event3');
  });
});
