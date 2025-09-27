/**
 * Tests for Event Module Services
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Jest provides describe, it, expect, beforeEach globally
import { Container } from '@nexus';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { EventMetadataService } from '../../../src/modules/events/event-metadata.service';
import { EventBusService } from '../../../src/modules/events/event-bus.service';
import { EventSchedulerService } from '../../../src/modules/events/event-scheduler.service';
import { EventValidationService } from '../../../src/modules/events/event-validation.service';
import { EventHistoryService } from '../../../src/modules/events/event-history.service';
import { EVENT_EMITTER_TOKEN } from '../../../src/modules/events/events.module';

describe('EventMetadataService', () => {
  let service: EventMetadataService;

  beforeEach(() => {
    service = new EventMetadataService();
  });

  describe('createMetadata', () => {
    it('should create metadata with required fields', () => {
      const metadata = service.createMetadata();

      expect(metadata).toHaveProperty('id');
      expect(metadata).toHaveProperty('timestamp');
      expect(metadata.id).toMatch(/^evt_/);
      expect(metadata.timestamp).toBeCloseTo(Date.now(), -2);
    });

    it('should merge partial metadata', () => {
      const metadata = service.createMetadata({
        userId: 'user123',
        source: 'api',
        tags: ['important']
      });

      expect(metadata.userId).toBe('user123');
      expect(metadata.source).toBe('api');
      expect(metadata.tags).toEqual(['important']);
    });

    it('should include default metadata', () => {
      service.setDefaultMetadata({
        environment: 'production',
        version: '1.0.0'
      });

      const metadata = service.createMetadata();

      expect(metadata['environment']).toBe('production');
      expect(metadata['version']).toBe('1.0.0');
    });
  });

  describe('generateEventId', () => {
    it('should generate unique event IDs', () => {
      const id1 = service.generateEventId();
      const id2 = service.generateEventId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^evt_\d+_[a-z0-9]+$/);
    });
  });

  describe('generateCorrelationId', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = service.generateCorrelationId();
      const id2 = service.generateCorrelationId();

      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^cor_\d+_\d+_[a-z0-9]+$/);
    });
  });

  describe('extractFromContext', () => {
    it('should extract metadata from context', () => {
      const context = {
        userId: 'user123',
        sessionId: 'session456',
        correlationId: 'cor789',
        source: 'web',
        tags: ['test'],
        priority: 5,
        extraField: 'ignored'
      };

      const metadata = service.extractFromContext(context);

      expect(metadata).toEqual({
        userId: 'user123',
        sessionId: 'session456',
        correlationId: 'cor789',
        source: 'web',
        tags: ['test'],
        priority: 5
      });
    });
  });

  describe('mergeMetadata', () => {
    it('should merge multiple metadata objects', () => {
      const merged = service.mergeMetadata(
        { userId: 'user1', source: 'api' },
        { sessionId: 'session1', source: 'web' },
        { tags: ['important'] }
      );

      expect(merged).toMatchObject({
        userId: 'user1',
        sessionId: 'session1',
        source: 'web', // Later value wins
        tags: ['important']
      });
    });

    it('should add required fields if missing', () => {
      const merged = service.mergeMetadata(
        { custom: 'value' }
      );

      expect(merged).toHaveProperty('id');
      expect(merged).toHaveProperty('timestamp');
    });
  });

  describe('addTags', () => {
    it('should add tags to metadata', () => {
      const metadata = service.createMetadata({ tags: ['existing'] });
      const updated = service.addTags(metadata, 'new1', 'new2');

      expect(updated.tags).toEqual(['existing', 'new1', 'new2']);
    });

    it('should prevent duplicate tags', () => {
      const metadata = service.createMetadata({ tags: ['tag1'] });
      const updated = service.addTags(metadata, 'tag1', 'tag2', 'tag1');

      expect(updated.tags).toEqual(['tag1', 'tag2']);
    });
  });

  describe('TTL management', () => {
    it('should set TTL for metadata', () => {
      const metadata = service.createMetadata();
      const withTTL = service.setTTL(metadata, 5000);

      expect(withTTL.ttl).toBe(5000);
      expect(withTTL['expiresAt']).toBeCloseTo(Date.now() + 5000, -2);
    });

    it('should check if metadata is expired', () => {
      const metadata = service.createMetadata();
      const expired = service.setTTL(metadata, -1000); // Already expired
      const valid = service.setTTL(metadata, 5000);

      expect(service.isExpired(expired)).toBe(true);
      expect(service.isExpired(valid)).toBe(false);
    });
  });

  describe('createChildMetadata', () => {
    it('should create child metadata with parent reference', () => {
      const parent = service.createMetadata({ correlationId: 'cor123' });
      const child = service.createChildMetadata(parent, { custom: 'value' });

      expect(child['parentId']).toBe(parent.id);
      expect(child.correlationId).toBe('cor123'); // Inherits correlation ID
      expect(child['custom']).toBe('value');
      expect(child.id).not.toBe(parent.id); // New ID
    });
  });
});

describe('EventBusService', () => {
  let service: EventBusService;
  let emitter: EnhancedEventEmitter;
  let container: Container;

  beforeEach(() => {
    container = new Container();
    emitter = new EnhancedEventEmitter();
    container.register(EVENT_EMITTER_TOKEN, { useValue: emitter });
    container.register(EventBusService, { 
      useClass: EventBusService,
      inject: [EVENT_EMITTER_TOKEN]
    });
    service = container.resolve(EventBusService);
  });

  describe('publish/subscribe', () => {
    it('should publish and subscribe to channels', async () => {
      const received: any[] = [];

      service.subscribeToChannel('test.channel', (message) => {
        received.push(message);
      });

      await service.publish('test.channel', { data: 'test' });

      expect(received).toHaveLength(1);
      expect(received[0]).toMatchObject({
        id: expect.any(String),
        event: 'test.channel',
        data: { data: 'test' },
        timestamp: expect.any(Number)
      });
    });

    it('should filter messages by target', async () => {
      const received: any[] = [];

      service.subscribeToChannel('channel', (message) => {
        received.push(message);
      }, { target: 'service1' });

      await service.publish('channel', { data: 1 }, { target: 'service1' });
      await service.publish('channel', { data: 2 }, { target: 'service2' });
      await service.publish('channel', { data: 3 }); // No target

      expect(received).toHaveLength(1);
      expect(received[0].data).toEqual({ data: 1 });
    });

    it('should apply custom filter', async () => {
      const received: any[] = [];

      service.subscribeToChannel('channel', (message) => {
        received.push(message);
      }, {
        filter: (msg) => msg.data.priority === 'high'
      });

      await service.publish('channel', { priority: 'low' });
      await service.publish('channel', { priority: 'high' });

      expect(received).toHaveLength(1);
      expect(received[0].data.priority).toBe('high');
    });
  });

  describe('request/reply pattern', () => {
    it('should handle request-response', async () => {
      // Set up responder
      service.subscribeToChannel('echo', async (message) => {
        await service.reply(message, `Echo: ${message.data}`);
      });

      // Make request
      const response = await service.request('echo', 'Hello', {
        timeout: 1000
      });

      expect(response).toBe('Echo: Hello');
    });

    it('should timeout on no response', async () => {
      await expect(
        service.request('no-handler', 'data', { timeout: 100 })
      ).rejects.toThrow('timeout');
    });
  });

  describe('channel statistics', () => {
    it('should track channel statistics', () => {
      service.subscribeToChannel('channel1', () => { });
      service.subscribeToChannel('channel1', () => { });
      service.subscribeToChannel('channel2', () => { });

      const stats = service.getChannelStats();

      expect(stats.get('channel1')).toMatchObject({
        subscribers: 2,
        queued: 0
      });
      expect(stats.get('channel2')).toMatchObject({
        subscribers: 1,
        queued: 0
      });
    });
  });
});

describe('EventSchedulerService', () => {
  let service: EventSchedulerService;
  let emitter: EnhancedEventEmitter;
  let container: Container;

  beforeEach(() => {
    container = new Container();
    emitter = new EnhancedEventEmitter();
    container.register(EVENT_EMITTER_TOKEN, { useValue: emitter });
    container.register(EventSchedulerService, { 
      useClass: EventSchedulerService,
      inject: [EVENT_EMITTER_TOKEN]
    });
    service = container.resolve(EventSchedulerService);
  });

  describe('scheduleEvent', () => {
    it('should schedule event with delay', async () => {
      const handler = jest.fn();
      emitter.on('delayed.event', handler);

      const jobId = service.scheduleEvent('delayed.event', { data: 'test' }, {
        delay: 50
      });

      expect(jobId).toMatch(/^job_/);
      expect(handler).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalledWith(
        { data: 'test' }
      );
    });

    it('should schedule event at specific time', async () => {
      const handler = jest.fn();
      emitter.on('scheduled.event', handler);

      const futureTime = new Date(Date.now() + 50);
      const jobId = service.scheduleEvent('scheduled.event', { data: 'test' }, {
        at: futureTime
      });

      expect(handler).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 100));

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('cancelJob', () => {
    it('should cancel scheduled job', async () => {
      const handler = jest.fn();
      emitter.on('cancelled.event', handler);

      const jobId = service.scheduleEvent('cancelled.event', {}, {
        delay: 100
      });

      const cancelled = service.cancelJob(jobId);

      expect(cancelled).toBe(true);

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('getJobs', () => {
    it('should get scheduled jobs', () => {
      const job1 = service.scheduleEvent('event1', {}, { delay: 1000 });
      const job2 = service.scheduleEvent('event2', {}, { delay: 2000 });

      const jobs = service.getJobs();

      expect(jobs).toHaveLength(2);
      expect(jobs.map(j => j.id)).toContain(job1);
      expect(jobs.map(j => j.id)).toContain(job2);
    });

    it('should filter jobs by status', async () => {
      const job1 = service.scheduleEvent('event1', {}, { delay: 10 });
      const job2 = service.scheduleEvent('event2', {}, { delay: 1000 });

      await new Promise(resolve => setTimeout(resolve, 50));

      const pendingJobs = service.getJobs({ status: 'pending' });
      const completedJobs = service.getJobs({ status: 'completed' });

      expect(pendingJobs.map(j => j.id)).toContain(job2);
      expect(completedJobs.map(j => j.id)).toContain(job1);
    });
  });

  describe('statistics', () => {
    it('should provide job statistics', async () => {
      service.scheduleEvent('event1', {}, { delay: 10 });
      service.scheduleEvent('event2', {}, { delay: 1000 });
      const cancelled = service.scheduleEvent('event3', {}, { delay: 1000 });

      service.cancelJob(cancelled);

      await new Promise(resolve => setTimeout(resolve, 50));

      const stats = service.getStatistics();

      expect(stats.total).toBe(3);
      expect(stats.cancelled).toBe(1);
      expect(stats.completed).toBeGreaterThanOrEqual(1);
    });
  });
});

describe('EventValidationService', () => {
  let service: EventValidationService;

  beforeEach(() => {
    service = new EventValidationService();
  });

  describe('validation', () => {
    it('should validate with registered schema', () => {
      service.registerSchema('test.event', {
        validate: (data) => {
          if (!data.required) {
            return { valid: false, errors: ['Missing required field'] };
          }
          return { valid: true };
        }
      });

      const valid = service.validate('test.event', { required: true });
      const invalid = service.validate('test.event', {});

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
      expect(invalid.errors).toContain('Missing required field');
    });

    it('should validate with custom validator', () => {
      service.registerValidator('custom.event', (data) => {
        if (typeof data.number !== 'number') {
          return { valid: false, errors: ['Must be a number'] };
        }
        return { valid: true };
      });

      const valid = service.validate('custom.event', { number: 42 });
      const invalid = service.validate('custom.event', { number: 'not-a-number' });

      expect(valid.valid).toBe(true);
      expect(invalid.valid).toBe(false);
    });

    it('should pass validation when no validator registered', () => {
      const result = service.validate('unregistered.event', { any: 'data' });

      expect(result.valid).toBe(true);
    });
  });

  describe('schema creation', () => {
    it('should create simple schema', () => {
      const schema = service.createSchema({
        type: 'object',
        required: ['name', 'age'],
        properties: {
          name: { type: 'string' },
          age: { type: 'number' }
        }
      });

      const result = schema.validate({ name: 'John' });

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Missing required property: age');
    });
  });
});

describe('EventHistoryService', () => {
  let service: EventHistoryService;
  let emitter: EnhancedEventEmitter;
  let container: Container;

  beforeEach(() => {
    container = new Container();
    emitter = new EnhancedEventEmitter();
    container.register(EVENT_EMITTER_TOKEN, { useValue: emitter });
    container.register(EventHistoryService, { 
      useClass: EventHistoryService,
      inject: [EVENT_EMITTER_TOKEN]
    });
    service = container.resolve(EventHistoryService);
  });

  describe('recording', () => {
    it('should start and stop recording', () => {
      expect(service.isRecordingActive()).toBe(false);

      service.startRecording();
      expect(service.isRecordingActive()).toBe(true);

      service.stopRecording();
      expect(service.isRecordingActive()).toBe(false);
    });

    it('should pause and resume recording', () => {
      service.startRecording();

      service.pauseRecording();
      expect(service.isRecordingActive()).toBe(false);

      service.resumeRecording();
      expect(service.isRecordingActive()).toBe(true);
    });
  });

  describe('history management', () => {
    it('should get event history', async () => {
      service.startRecording();

      emitter.emitEnhanced('event1', { data: 1 });
      emitter.emitEnhanced('event2', { data: 2 });

      const history = await service.getHistory();

      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({
        event: 'event1',
        data: { data: 1 }
      });
    });

    it('should clear history', async () => {
      service.startRecording();

      emitter.emitEnhanced('event1', {});
      emitter.emitEnhanced('event2', {});

      await service.clearHistory();

      const history = await service.getHistory();
      expect(history).toHaveLength(0);
    });
  });

  describe('export/import', () => {
    it('should export history as JSON', async () => {
      service.startRecording();

      emitter.emitEnhanced('event1', { data: 'test' });

      const exported = await service.exportHistory('json');
      const parsed = JSON.parse(exported);

      expect(parsed).toBeInstanceOf(Array);
      expect(parsed[0]).toMatchObject({
        event: 'event1',
        data: { data: 'test' }
      });
    });

    it('should export history as CSV', async () => {
      service.startRecording();

      emitter.emitEnhanced('event1', { data: 'test' });

      const csv = await service.exportHistory('csv');

      expect(csv).toContain('timestamp,event,data,metadata,duration,error');
      expect(csv).toContain('event1');
    });
  });

  describe('statistics', () => {
    it('should calculate event statistics', async () => {
      service.startRecording();

      emitter.emitEnhanced('event1', {});
      emitter.emitEnhanced('event1', {});
      emitter.emitEnhanced('event2', {});

      const stats = await service.getStatistics();

      expect(stats.totalEvents).toBe(3);
      expect(stats.uniqueEvents).toBe(2);
      expect(stats.errorRate).toBe(0);
    });
  });
});
