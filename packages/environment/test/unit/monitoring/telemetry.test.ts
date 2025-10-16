import { describe, it, expect, beforeEach } from 'vitest';
import { Telemetry } from '../../../src/monitoring/telemetry.js';

describe('Telemetry', () => {
  let telemetry: Telemetry;

  beforeEach(() => {
    telemetry = new Telemetry({ maxEvents: 100 });
  });

  it('should track events', () => {
    telemetry.trackEvent('TestEvent', { key: 'value' });
    expect(telemetry.getEventCount()).toBe(1);
  });

  it('should track metrics', () => {
    telemetry.trackMetric('latency', 100);
    const events = telemetry.getEventsByName('Metric');
    expect(events).toHaveLength(1);
  });

  it('should track exceptions', () => {
    const error = new Error('Test error');
    telemetry.trackException(error);
    const events = telemetry.getEventsByName('Exception');
    expect(events).toHaveLength(1);
  });

  it('should get events by name', () => {
    telemetry.trackEvent('Event1');
    telemetry.trackEvent('Event2');
    telemetry.trackEvent('Event1');
    expect(telemetry.getEventsByName('Event1')).toHaveLength(2);
  });

  it('should get statistics', () => {
    telemetry.trackEvent('Event1');
    telemetry.trackEvent('Event2');
    const stats = telemetry.getStats();
    expect(stats.total).toBe(2);
    expect(stats.byName.Event1).toBe(1);
  });

  it('should export events', () => {
    telemetry.trackEvent('Event1');
    const exported = telemetry.export();
    expect(exported).toHaveLength(1);
    expect(telemetry.getEventCount()).toBe(0);
  });

  it('should respect enabled flag', () => {
    telemetry.setEnabled(false);
    telemetry.trackEvent('Event1');
    expect(telemetry.getEventCount()).toBe(0);
  });
});
