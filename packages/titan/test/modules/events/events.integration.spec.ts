/**
 * Integration tests for Titan Event System
 */

import 'reflect-metadata';
import { EnhancedEventEmitter } from '@omnitron-dev/eventemitter';
import { EventsService } from '../../../src/modules/events/events.service';
import { EventBusService } from '../../../src/modules/events/event-bus.service';
import { EventHistoryService } from '../../../src/modules/events/event-history.service';
import { EventMetadataService } from '../../../src/modules/events/event-metadata.service';

describe('Event System Integration', () => {
  let eventsService: EventsService;
  let eventBus: EventBusService;
  let historyService: EventHistoryService;
  let metadataService: EventMetadataService;
  let emitter: EnhancedEventEmitter;

  beforeEach(() => {
    // Use real EnhancedEventEmitter for integration testing
    emitter = new EnhancedEventEmitter();
    // Enable history on the emitter
    emitter.enableHistory();
    metadataService = new EventMetadataService();

    // Initialize services
    eventsService = new EventsService(emitter, metadataService);
    eventBus = new EventBusService(emitter);
    historyService = new EventHistoryService(emitter);
  });

  afterEach(() => {
    // Clean up
    if (eventsService && typeof eventsService.onDestroy === 'function') {
      eventsService.onDestroy();
    }
    if (eventBus && typeof eventBus.onDestroy === 'function') {
      eventBus.onDestroy();
    }
    if (historyService && typeof historyService.onDestroy === 'function') {
      historyService.onDestroy();
    }
  });

  it('should handle complex event flow', async () => {
    const results: string[] = [];

    // Set up handlers with different priorities
    eventsService.on('integration.test', () => results.push('handler1'), { priority: 1 });
    eventsService.on('integration.test', () => results.push('handler2'), { priority: 10 });
    eventsService.on('integration.test', () => results.push('handler3'), { priority: 5 });

    // Emit event
    eventsService.emit('integration.test', { test: true });

    // Check execution order
    expect(results).toEqual(['handler2', 'handler3', 'handler1']);

    // Check history - the emitter should have recorded it automatically
    const history = await historyService.getHistory('integration.test');
    expect(history).toHaveLength(1);
    expect(history[0].data).toEqual({ test: true });
  });

  it('should handle event bubbling', async () => {
    const results: string[] = [];

    eventsService.on('parent', () => results.push('parent'));
    eventsService.on('parent.child', () => results.push('child'));
    eventsService.on('parent.child.grandchild', () => results.push('grandchild'));

    // Enable bubbling
    eventsService.enableBubbling(true);

    await eventsService.emit('parent.child.grandchild', {});

    expect(results).toEqual(['grandchild', 'child', 'parent']);
  });

  it('should handle event transactions', async () => {
    const results: any[] = [];
    let transactionId: string | null = null;

    eventsService.on('transaction.start', (data) => {
      transactionId = data.transactionId;
      results.push({ event: 'start', id: transactionId });
    });

    eventsService.on('transaction.commit', (data) => {
      results.push({ event: 'commit', id: data.transactionId });
    });

    eventsService.on('transaction.rollback', (data) => {
      results.push({ event: 'rollback', id: data.transactionId });
    });

    // Start transaction
    const txId = 'tx-123';
    await eventsService.emit('transaction.start', { transactionId: txId });
    await eventsService.emit('transaction.commit', { transactionId: txId });

    expect(results).toHaveLength(2);
    expect(results[0].event).toBe('start');
    expect(results[1].event).toBe('commit');
    expect(results[0].id).toBe(results[1].id);
  });

  it('should handle cross-service event communication', async () => {
    const received: any[] = [];

    // Both services subscribe to the same event
    eventBus.subscribe('cross.service', (data) => {
      received.push({ source: 'eventBus', data });
    });

    eventsService.on('cross.service', (data) => {
      received.push({ source: 'eventsService', data });
    });

    // Emit through EventsService
    eventsService.emit('cross.service', { test: 'data' });

    // EventsService handler should receive the event
    expect(received).toHaveLength(1);
    expect(received[0].source).toBe('eventsService');

    // Now emit through EventBus
    await eventBus.emit('cross.service', { test: 'data2' });

    // Now EventBus handler should also have received its own event
    expect(received).toHaveLength(2);
    expect(received[1].source).toBe('eventBus');
  });

  it('should maintain event ordering across async operations', async () => {
    const order: number[] = [];

    // Create async handlers with different delays
    eventsService.on('order.test', async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
      order.push(1);
    });

    eventsService.on('order.test', async () => {
      await new Promise(resolve => setTimeout(resolve, 25));
      order.push(2);
    });

    eventsService.on('order.test', async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      order.push(3);
    });

    // Emit in series mode
    await eventsService.emitSerial('order.test', {});

    // Should maintain order despite different delays
    expect(order).toEqual([1, 2, 3]);
  });
});