/**
 * Tests for EventsModule
 */
import { describe, it, expect, jest } from '@jest/globals';

import 'reflect-metadata';
import { EventsModule, EVENTS_SERVICE_TOKEN, EVENT_BUS_SERVICE_TOKEN } from '../../../src/modules/events/events.module';

describe('EventsModule', () => {
  it('should configure event module', () => {
    const config = EventsModule.forRoot({
      enableHistory: true,
      maxHistorySize: 100,
      enableValidation: true,
      enableScheduler: true,
    });

    expect(config.module).toBe(EventsModule);
    expect(config.providers).toBeDefined();
    expect(config.exports).toBeDefined();
  });

  it('should configure async module', async () => {
    const configFactory = jest.fn().mockResolvedValue({
      enableHistory: true,
      maxHistorySize: 200,
    });

    const config = EventsModule.forRootAsync({
      useFactory: configFactory,
    });

    expect(config.module).toBe(EventsModule);
    expect(config.providers).toBeDefined();
  });

  it('should provide default configuration', () => {
    const config = EventsModule.forRoot({});
    expect(config.module).toBe(EventsModule);
    expect(config.providers).toHaveLength(9); // Options + Emitter + 7 services
  });

  it('should export event services', () => {
    const config = EventsModule.forRoot({});
    expect(config.exports).toContain(EVENTS_SERVICE_TOKEN);
    expect(config.exports).toContain(EVENT_BUS_SERVICE_TOKEN);
  });
});
