/**
 * Tests for EventHistoryService
 */

import 'reflect-metadata';
import { EventHistoryService } from '../../../src/modules/events/event-history.service';

describe('EventHistoryService', () => {
  let historyService: EventHistoryService;
  let mockEmitter: any;

  beforeEach(() => {
    mockEmitter = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listeners: jest.fn().mockReturnValue([]),
      eventNames: jest.fn().mockReturnValue([]),
      enableHistory: jest.fn(),
      disableHistory: jest.fn(),
      getHistory: jest.fn().mockReturnValue([]),
      clearHistory: jest.fn()
    };

    historyService = new EventHistoryService(mockEmitter);
  });

  afterEach(() => {
    if (historyService && typeof historyService.onDestroy === 'function') {
      historyService.onDestroy();
    }
  });

  it('should record event history', () => {
    // Enable recording first
    historyService.startRecording();

    historyService.record({
      event: 'test.event',
      data: { test: true },
      timestamp: Date.now()
    });

    const history = historyService.getHistorySync('test.event');
    expect(history).toHaveLength(1);
    expect(history[0].event).toBe('test.event');
  });

  it('should limit history size', () => {
    // Enable recording first
    historyService.startRecording();
    historyService.setMaxHistory(3);

    for (let i = 0; i < 5; i++) {
      historyService.record({
        event: 'limited.event',
        data: { id: i },
        timestamp: Date.now()
      });
    }

    const history = historyService.getHistorySync('limited.event');
    expect(history).toHaveLength(3);
    expect(history[0].data.id).toBe(2);
  });

  it('should clear history', () => {
    // Enable recording first
    historyService.startRecording();

    historyService.record({
      event: 'clear.event',
      data: {},
      timestamp: Date.now()
    });

    // Use the correct method name for clearing history
    historyService.clear('clear.event');
    const history = historyService.getHistorySync('clear.event');
    expect(history).toHaveLength(0);
  });

  it('should get statistics', () => {
    // Enable recording first
    historyService.startRecording();

    historyService.record({ event: 'stats.event', data: {}, timestamp: Date.now() });
    historyService.record({ event: 'stats.event', data: {}, timestamp: Date.now() });
    historyService.record({ event: 'other.event', data: {}, timestamp: Date.now() });

    const stats = historyService.getStatisticsSync();
    expect(stats['stats.event']).toBe(2);
    expect(stats['other.event']).toBe(1);
  });
});