import 'reflect-metadata';
import { describe, expect, it } from 'vitest';
import { METADATA_KEYS } from '@omnitron-dev/titan/decorators';
import { NodeManagerRpcService } from '../../src/services/node-manager.rpc-service.js';
import { SyncRpcService } from '../../src/services/sync.rpc-service.js';
import { syncFinding, syncSeverity, syncWords } from '../../src/shared/sync-reading.js';

describe('historical replication repair access and diagnostics', () => {
  it('limits the coordinator to administrators and source repair to the trusted control plane', () => {
    expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, NodeManagerRpcService.prototype, 'reconcileNodeMetrics')).toEqual({ roles: ['admin'] });
    for (const method of ['readUnverifiedMetrics', 'acknowledgeReconciliation']) {
      expect(Reflect.getMetadata(METADATA_KEYS.METHOD_AUTH, SyncRpcService.prototype, method)).toEqual({ roles: ['admin', 'service_role'] });
    }
  });

  it('does not show a failed history read as a healthy empty queue', () => {
    const finding = syncFinding({ pendingItems: 0, lastSyncAt: Date.now(), reconciliationError: 'database unavailable' });
    expect(syncSeverity(finding)).toBe('warning');
    expect(syncWords(finding)).toContain('Reconciliation history unavailable: database unavailable');
  });
});
