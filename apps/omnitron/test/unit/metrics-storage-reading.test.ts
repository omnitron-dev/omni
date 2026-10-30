import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { metricsStorageReading } from '../../src/shared/metrics-storage-reading.js';
import { OmnitronMetricsRpcService } from '../../src/services/metrics.rpc-service.js';
import type { MetricsStorageStatus } from '../../src/shared/dto/metrics.js';

const now = Date.now();
const status: MetricsStorageStatus = { type: 'postgres', durability: 'persistent', pendingSamples: 0,
  pendingBytes: 0, capacityBytes: 16777216, capacity: 50000, oldestPendingAt: null, writing: false,
  writtenSamples: 100, droppedSamples: 0, failedWrites: 0, lastWriteAt: new Date(now).toISOString(),
  lastError: null, cleanupError: null, syncError: null };

describe('the same persistence reading for health, CLI and Console', () => {
  it('never interprets missing or volatile evidence as a database commit', () => {
    expect(metricsStorageReading(null).severity).toBe('warning');
    expect(metricsStorageReading({ ...status, durability: 'volatile' }).detail).toContain('lost on restart');
    expect(metricsStorageReading({ ...status, lastWriteAt: null }).summary).toContain('awaiting');
    expect(metricsStorageReading(status).severity).toBe('success');
  });
  it('distinguishes write refusal, retention, delayed writes and loss after recovery', () => {
    expect(metricsStorageReading({ ...status, lastError: 'disk full' }).detail).toContain('Write failed: disk full');
    expect(metricsStorageReading({ ...status, cleanupError: 'locked' }).detail).toContain('Retention failed: locked');
    expect(metricsStorageReading({ ...status, pendingSamples: 2, oldestPendingAt: new Date(now - 65000).toISOString() }, now).severity).toBe('warning');
    expect(metricsStorageReading({ ...status, droppedSamples: 1 }).detail).toContain('1 samples lost');
  });
  it('allows viewers to inspect storage and denies them maintenance', () => {
    const roles = (method: string) => Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, OmnitronMetricsRpcService.prototype, method).roles;
    expect(roles('getStorageStatus')).toContain('viewer');
    expect(roles('querySeries')).toContain('service_role');
    expect(roles('flush')).not.toContain('viewer');
    expect(roles('cleanup')).toEqual(['admin']);
    expect(roles('evictApp')).toEqual(['admin']);
  });
});
