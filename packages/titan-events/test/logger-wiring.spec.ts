/**
 * EV-2 regression — the logger must be wired into the event services. Three
 * services declared `private logger: ILogger | null = null` but their
 * constructors never accepted/assigned it, so every this.logger.* call was a
 * silent no-op. They now take `@Optional() @Inject(LOGGER_TOKEN) logger` (the
 * same pattern EventBusService already used) and assign it.
 */

import { describe, it, expect, vi } from 'vitest';
import { EventsService } from '../src/events.service.js';
import { EventSchedulerService } from '../src/event-scheduler.service.js';
import { EventValidationService } from '../src/event-validation.service.js';

function makeLogger() {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn(), fatal: vi.fn() } as any;
}

describe('event services logger wiring (EV-2)', () => {
  it('EventsService assigns the injected logger', () => {
    const logger = makeLogger();
    const svc = new EventsService({} as any, {} as any, logger);
    expect((svc as any).logger).toBe(logger);
  });

  it('EventSchedulerService assigns the injected logger', () => {
    const logger = makeLogger();
    const svc = new EventSchedulerService({} as any, logger);
    expect((svc as any).logger).toBe(logger);
  });

  it('EventValidationService assigns the injected logger', () => {
    const logger = makeLogger();
    const svc = new EventValidationService(logger);
    expect((svc as any).logger).toBe(logger);
  });

  it('defaults logger to null when none is injected (optional)', () => {
    expect((new EventValidationService() as any).logger).toBeNull();
    expect((new EventSchedulerService({} as any) as any).logger).toBeNull();
  });
});
