/**
 * EV-2, second half — the logger must survive the trip through DI.
 *
 * `logger-wiring.spec.ts` proves the constructors assign a logger they are
 * handed, by calling `new EventsService(..., logger)` directly. That check
 * passes whether or not anything ever hands them one: it supplies by hand the
 * exact connection whose absence is the defect. Every application boots these
 * services through the module's `inject:` arrays, and those arrays are the
 * thing that has to be right.
 *
 * So resolve each service the way an application does — through a container
 * built from `EventsModule.forRoot()` — and assert the logger arrived.
 */

import 'reflect-metadata';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '@omnitron-dev/titan/nexus';

import {
  EventsModule,
  LOGGER_TOKEN,
  EVENTS_SERVICE_TOKEN,
  EVENT_BUS_SERVICE_TOKEN,
  EVENT_SCHEDULER_SERVICE_TOKEN,
  EVENT_VALIDATION_SERVICE_TOKEN,
  EVENT_HISTORY_SERVICE_TOKEN,
  EVENT_DISCOVERY_SERVICE_TOKEN,
  EVENT_METADATA_SERVICE_TOKEN,
} from '../src/events.module.js';

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(),
  } as any;
}

/** Register a module definition's provider tuples into a fresh container. */
function containerFor(moduleDef: { providers: ReadonlyArray<readonly [any, any]> }, logger: unknown): Container {
  const container = new Container();
  container.register(LOGGER_TOKEN, { useValue: logger });
  for (const [token, provider] of moduleDef.providers) {
    container.register(token, provider);
  }
  return container;
}

const SERVICES: ReadonlyArray<readonly [string, any]> = [
  ['EventsService', EVENTS_SERVICE_TOKEN],
  ['EventBusService', EVENT_BUS_SERVICE_TOKEN],
  ['EventSchedulerService', EVENT_SCHEDULER_SERVICE_TOKEN],
  ['EventValidationService', EVENT_VALIDATION_SERVICE_TOKEN],
  ['EventHistoryService', EVENT_HISTORY_SERVICE_TOKEN],
  ['EventDiscoveryService', EVENT_DISCOVERY_SERVICE_TOKEN],
  ['EventMetadataService', EVENT_METADATA_SERVICE_TOKEN],
];

describe('event services logger wiring through DI (EV-2)', () => {
  let logger: ReturnType<typeof makeLogger>;

  beforeEach(() => {
    logger = makeLogger();
  });

  describe('forRoot', () => {
    for (const [name, token] of SERVICES) {
      it(`${name} receives the container's logger`, () => {
        const container = containerFor(EventsModule.forRoot({}), logger);
        const service = container.resolve(token) as any;
        expect(service.logger, `${name}.logger is not wired — its log calls are silent no-ops`).toBe(logger);
      });
    }
  });

  describe('forRootAsync', () => {
    for (const [name, token] of SERVICES) {
      it(`${name} receives the container's logger`, async () => {
        const moduleDef = EventsModule.forRootAsync({ useFactory: () => ({}) });
        const container = containerFor(moduleDef, logger);
        const service = (await container.resolveAsync(token)) as any;
        expect(service.logger, `${name}.logger is not wired — its log calls are silent no-ops`).toBe(logger);
      });
    }
  });

  it('a wired logger actually reaches the log calls', () => {
    const container = containerFor(EventsModule.forRoot({}), logger);
    const bus = container.resolve(EVENT_BUS_SERVICE_TOKEN) as any;
    bus.configureQueue({ maxQueueSize: 10 });
    expect(logger.info).toHaveBeenCalled();
  });

  it('resolving the module logs no DI arity warning', () => {
    // Nexus warns when a constructor declares more parameters than the inject
    // array supplies, because the extras arrive as undefined. Every app using
    // titan-events printed one of these for EventBusService on every boot.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const container = containerFor(EventsModule.forRoot({}), logger);
      for (const [, token] of SERVICES) container.resolve(token);
      const arity = warn.mock.calls.filter((c) => String(c[0]).includes('arity mismatch'));
      expect(arity, `unexpected arity warnings:\n${arity.map((c) => c[0]).join('\n')}`).toHaveLength(0);
    } finally {
      warn.mockRestore();
    }
  });

  it('services still resolve when no logger is registered', () => {
    const container = new Container();
    for (const [token, provider] of EventsModule.forRoot({}).providers) {
      container.register(token, provider);
    }
    for (const [name, token] of SERVICES) {
      const service = container.resolve(token) as any;
      expect(service, name).toBeDefined();
      expect(service.logger ?? null, `${name}.logger should degrade to null`).toBeNull();
    }
  });
});
