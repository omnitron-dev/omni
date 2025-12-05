/**
 * Feature Flags Tests
 */

import 'reflect-metadata';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FeatureFlagManager,
  ABTestingFramework,
  type FeatureFlag,
  type EvaluationContext,
  type FlagCondition,
  type FlagVariant,
  type RolloutConfig,
  type FlagOverride,
} from '../../../../src/modules/pm/enterprise/feature-flags.js';

describe('FeatureFlagManager', () => {
  let manager: FeatureFlagManager;

  beforeEach(() => {
    manager = new FeatureFlagManager({
      cacheTTL: 1000,
      defaultEnabled: false,
      enableAuditLog: true,
    });
  });

  describe('Basic Flag Management', () => {
    it('should create a new flag', () => {
      const flag = manager.upsertFlag(
        {
          id: 'test-flag',
          name: 'Test Flag',
          description: 'A test feature flag',
          enabled: true,
        },
        'test-user'
      );

      expect(flag.id).toBe('test-flag');
      expect(flag.name).toBe('Test Flag');
      expect(flag.enabled).toBe(true);
      expect(flag.createdAt).toBeInstanceOf(Date);
      expect(flag.updatedAt).toBeInstanceOf(Date);
    });

    it('should update an existing flag', () => {
      manager.upsertFlag(
        {
          id: 'test-flag',
          name: 'Test Flag',
          enabled: false,
        },
        'user1'
      );

      const updated = manager.upsertFlag(
        {
          id: 'test-flag',
          name: 'Updated Flag',
          enabled: true,
        },
        'user2'
      );

      expect(updated.name).toBe('Updated Flag');
      expect(updated.enabled).toBe(true);

      // Check audit log
      const auditLog = manager.getAuditLog({ flagId: 'test-flag' });
      expect(auditLog).toHaveLength(2);
      expect(auditLog[0]?.action).toBe('created');
      expect(auditLog[1]?.action).toBe('updated');
      expect(auditLog[1]?.changes?.name).toEqual({ old: 'Test Flag', new: 'Updated Flag' });
    });

    it('should get a flag', () => {
      manager.upsertFlag({
        id: 'test-flag',
        name: 'Test Flag',
        enabled: true,
      });

      const flag = manager.getFlag('test-flag');
      expect(flag).toBeDefined();
      expect(flag?.id).toBe('test-flag');
    });

    it('should delete a flag', () => {
      manager.upsertFlag({
        id: 'test-flag',
        name: 'Test Flag',
        enabled: true,
      });

      const deleted = manager.deleteFlag('test-flag', 'admin');
      expect(deleted).toBe(true);
      expect(manager.getFlag('test-flag')).toBeUndefined();

      // Check audit log
      const auditLog = manager.getAuditLog({ flagId: 'test-flag', action: 'deleted' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.actor).toBe('admin');
    });

    it('should get all flags', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: false });

      const flags = manager.getAllFlags();
      expect(flags).toHaveLength(2);
    });
  });

  describe('Kill Switch', () => {
    beforeEach(() => {
      manager.upsertFlag({
        id: 'dangerous-feature',
        name: 'Dangerous Feature',
        enabled: true,
      });
    });

    it('should kill a flag', () => {
      manager.killFlag('dangerous-feature', 'Production issue detected', 'admin');

      const flag = manager.getFlag('dangerous-feature');
      expect(flag?.killed).toBe(true);
      expect(flag?.killReason).toBe('Production issue detected');
      expect(flag?.killedBy).toBe('admin');
      expect(flag?.killedAt).toBeInstanceOf(Date);
    });

    it('should prevent evaluation of killed flags', () => {
      manager.killFlag('dangerous-feature', 'Emergency disable');

      const result = manager.evaluate('dangerous-feature', { userId: 'user1' });
      expect(result.enabled).toBe(false);
      expect(result.reason).toContain('Flag killed');
    });

    it('should restore a killed flag', () => {
      manager.killFlag('dangerous-feature', 'Test kill');
      manager.restoreFlag('dangerous-feature', 'admin');

      const flag = manager.getFlag('dangerous-feature');
      expect(flag?.killed).toBe(false);
      expect(flag?.killReason).toBeUndefined();
      expect(flag?.killedBy).toBeUndefined();

      // Flag should be evaluable again
      const result = manager.evaluate('dangerous-feature', { userId: 'user1' });
      expect(result.enabled).toBe(true);
    });

    it('should throw error when restoring non-killed flag', () => {
      expect(() => {
        manager.restoreFlag('dangerous-feature', 'admin');
      }).toThrow('Flag is not killed');
    });

    it('should bulk kill multiple flags', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: true });

      manager.bulkKillFlags(['dangerous-feature', 'flag1', 'flag2'], 'Emergency shutdown', 'admin');

      expect(manager.getFlag('dangerous-feature')?.killed).toBe(true);
      expect(manager.getFlag('flag1')?.killed).toBe(true);
      expect(manager.getFlag('flag2')?.killed).toBe(true);
    });

    it('should log kill actions in audit', () => {
      manager.killFlag('dangerous-feature', 'Emergency');

      const auditLog = manager.getAuditLog({ flagId: 'dangerous-feature', action: 'killed' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.metadata?.reason).toBe('Emergency');
    });
  });

  describe('Flag Evaluation', () => {
    it('should evaluate a simple enabled flag', () => {
      manager.upsertFlag({
        id: 'simple-flag',
        name: 'Simple Flag',
        enabled: true,
      });

      const result = manager.evaluate('simple-flag');
      expect(result.enabled).toBe(true);
      expect(result.reason).toBe('Flag enabled');
    });

    it('should evaluate a disabled flag', () => {
      manager.upsertFlag({
        id: 'disabled-flag',
        name: 'Disabled Flag',
        enabled: false,
      });

      const result = manager.evaluate('disabled-flag');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('Flag is globally disabled');
    });

    it('should return default for non-existent flag', () => {
      const result = manager.evaluate('non-existent');
      expect(result.enabled).toBe(false);
      expect(result.reason).toBe('Flag not found');
    });

    it('should cache evaluation results', () => {
      manager.upsertFlag({
        id: 'cached-flag',
        name: 'Cached Flag',
        enabled: true,
      });

      const result1 = manager.evaluate('cached-flag', { userId: 'user1' });
      const result2 = manager.evaluate('cached-flag', { userId: 'user1' });

      expect(result1).toEqual(result2);
    });

    it('should invalidate cache on flag update', () => {
      manager.upsertFlag({
        id: 'flag',
        name: 'Flag',
        enabled: true,
      });

      const result1 = manager.evaluate('flag');
      expect(result1.enabled).toBe(true);

      manager.upsertFlag({
        id: 'flag',
        name: 'Flag',
        enabled: false,
      });

      const result2 = manager.evaluate('flag');
      expect(result2.enabled).toBe(false);
    });
  });

  describe('Conditions', () => {
    it('should evaluate user condition', () => {
      const condition: FlagCondition = {
        type: 'user',
        operator: 'in',
        value: ['user1', 'user2', 'user3'],
      };

      manager.upsertFlag({
        id: 'user-flag',
        name: 'User Flag',
        enabled: true,
        conditions: [condition],
      });

      const result1 = manager.evaluate('user-flag', { userId: 'user1' });
      expect(result1.enabled).toBe(true);

      const result2 = manager.evaluate('user-flag', { userId: 'user4' });
      expect(result2.enabled).toBe(false);
      expect(result2.reason).toBe('Conditions not met');
    });

    it('should evaluate group condition', () => {
      const condition: FlagCondition = {
        type: 'group',
        operator: 'eq',
        value: 'beta-testers',
      };

      manager.upsertFlag({
        id: 'group-flag',
        name: 'Group Flag',
        enabled: true,
        conditions: [condition],
      });

      const result1 = manager.evaluate('group-flag', { groupId: 'beta-testers' });
      expect(result1.enabled).toBe(true);

      const result2 = manager.evaluate('group-flag', { groupId: 'general' });
      expect(result2.enabled).toBe(false);
    });

    it('should evaluate percentage condition', () => {
      const condition: FlagCondition = {
        type: 'percentage',
        operator: 'lt',
        value: 0.5, // 50%
      };

      manager.upsertFlag({
        id: 'percentage-flag',
        name: 'Percentage Flag',
        enabled: true,
        conditions: [condition],
      });

      // Test with consistent user IDs
      const results = [];
      for (let i = 0; i < 100; i++) {
        const result = manager.evaluate('percentage-flag', { userId: `user${i}` });
        if (result.enabled) results.push(result);
      }

      // Roughly 50% should be enabled (allow ±20% variance)
      expect(results.length).toBeGreaterThan(30);
      expect(results.length).toBeLessThan(70);
    });

    it('should evaluate time condition', () => {
      const now = Date.now();
      const futureTime = now + 10000;

      const condition: FlagCondition = {
        type: 'time',
        operator: 'gt',
        value: futureTime,
      };

      manager.upsertFlag({
        id: 'time-flag',
        name: 'Time Flag',
        enabled: true,
        conditions: [condition],
      });

      // Test 1: Current time is before future time, should be disabled
      const result1 = manager.evaluate('time-flag', { timestamp: now });
      expect(result1.enabled).toBe(false);
      expect(result1.reason).toBe('Conditions not met');

      // Test 2: Time is after future time, should be enabled
      // Use a different userId to avoid cache collision
      const result2 = manager.evaluate('time-flag', { timestamp: futureTime + 1000, userId: 'user1' });
      expect(result2.enabled).toBe(true);
      expect(result2.reason).toBe('Flag enabled');
    });

    it('should evaluate custom condition with properties', () => {
      const condition: FlagCondition = {
        type: 'custom',
        operator: 'eq',
        value: 'premium',
      };

      manager.upsertFlag({
        id: 'custom-flag',
        name: 'Custom Flag',
        enabled: true,
        conditions: [condition],
      });

      const result1 = manager.evaluate('custom-flag', {
        properties: { custom: 'premium' },
      });
      expect(result1.enabled).toBe(true);

      const result2 = manager.evaluate('custom-flag', {
        properties: { custom: 'free' },
      });
      expect(result2.enabled).toBe(false);
    });

    it('should evaluate multiple conditions (AND logic)', () => {
      const conditions: FlagCondition[] = [
        { type: 'user', operator: 'in', value: ['user1', 'user2'] },
        { type: 'group', operator: 'eq', value: 'beta' },
      ];

      manager.upsertFlag({
        id: 'multi-condition-flag',
        name: 'Multi Condition Flag',
        enabled: true,
        conditions,
      });

      // Both conditions met
      const result1 = manager.evaluate('multi-condition-flag', {
        userId: 'user1',
        groupId: 'beta',
      });
      expect(result1.enabled).toBe(true);

      // Only one condition met
      const result2 = manager.evaluate('multi-condition-flag', {
        userId: 'user1',
        groupId: 'general',
      });
      expect(result2.enabled).toBe(false);
    });
  });

  describe('Variants and A/B Testing', () => {
    it('should select variant based on weights', () => {
      const variants: FlagVariant[] = [
        { id: 'control', name: 'Control', value: 'A', weight: 50 },
        { id: 'variant-b', name: 'Variant B', value: 'B', weight: 50 },
      ];

      manager.upsertFlag({
        id: 'ab-test',
        name: 'A/B Test',
        enabled: true,
        variants,
      });

      const results = new Map<string, number>();
      for (let i = 0; i < 1000; i++) {
        const result = manager.evaluate('ab-test', { userId: `test-user-${i}` });
        const variant = result.variant || 'unknown';
        results.set(variant, (results.get(variant) || 0) + 1);
      }

      // With 1000 samples and 50/50 split, both variants should be present
      const controlCount = results.get('control') || 0;
      const variantBCount = results.get('variant-b') || 0;

      // All evaluations should return a variant
      expect(controlCount + variantBCount).toBe(1000);
      // Both variants should be selected at least once (very conservative check)
      expect(controlCount).toBeGreaterThan(0);
      expect(variantBCount).toBeGreaterThan(0);
      // With 1000 samples, distribution should be somewhat reasonable (20%-80% range)
      expect(controlCount).toBeGreaterThan(200);
      expect(controlCount).toBeLessThan(800);
    });

    it('should return variant value', () => {
      const variants: FlagVariant[] = [
        { id: 'control', name: 'Control', value: { color: 'blue' }, weight: 50 },
        { id: 'variant', name: 'Variant', value: { color: 'red' }, weight: 50 },
      ];

      manager.upsertFlag({
        id: 'color-test',
        name: 'Color Test',
        enabled: true,
        variants,
      });

      const result = manager.evaluate('color-test', { userId: 'user1' });
      expect(result.value).toBeDefined();
      expect(['blue', 'red']).toContain((result.value as { color: string }).color);
    });

    it('should handle variant overrides', () => {
      const variants: FlagVariant[] = [
        {
          id: 'control',
          name: 'Control',
          value: 'A',
          weight: 90,
          overrides: [
            {
              condition: { type: 'user', operator: 'eq', value: 'vip-user' },
              variantId: 'vip',
            },
          ],
        },
        { id: 'vip', name: 'VIP', value: 'VIP', weight: 10 },
      ];

      manager.upsertFlag({
        id: 'override-test',
        name: 'Override Test',
        enabled: true,
        variants,
      });

      // VIP user should get VIP variant
      const vipResult = manager.evaluate('override-test', { userId: 'vip-user' });
      expect(vipResult.variant).toBe('vip');
      expect(vipResult.value).toBe('VIP');

      // Regular user should get control or vip based on weight
      const regularResult = manager.evaluate('override-test', { userId: 'regular-user' });
      expect(['control', 'vip']).toContain(regularResult.variant);
    });
  });

  describe('Rollout Strategies', () => {
    it('should evaluate percentage rollout', () => {
      const rollout: RolloutConfig = {
        strategy: 'percentage',
        percentage: 30,
      };

      manager.upsertFlag({
        id: 'rollout-flag',
        name: 'Rollout Flag',
        enabled: true,
        rollout,
      });

      const results = [];
      for (let i = 0; i < 100; i++) {
        const result = manager.evaluate('rollout-flag', { userId: `user${i}` });
        if (result.enabled) results.push(result);
      }

      // Roughly 30% should be enabled (allow ±15% variance)
      expect(results.length).toBeGreaterThan(15);
      expect(results.length).toBeLessThan(45);
    });

    it('should evaluate blue-green rollout', () => {
      const futureTime = new Date(Date.now() + 10000);

      const rollout: RolloutConfig = {
        strategy: 'blue-green',
        startTime: futureTime,
      };

      manager.upsertFlag({
        id: 'blue-green-flag',
        name: 'Blue-Green Flag',
        enabled: true,
        rollout,
      });

      // Before start time
      const result1 = manager.evaluate('blue-green-flag', { userId: 'user1' });
      expect(result1.enabled).toBe(false);

      // After start time (simulate)
      const pastRollout: RolloutConfig = {
        strategy: 'blue-green',
        startTime: new Date(Date.now() - 1000),
      };

      manager.upsertFlag({
        id: 'blue-green-flag',
        name: 'Blue-Green Flag',
        enabled: true,
        rollout: pastRollout,
      });

      const result2 = manager.evaluate('blue-green-flag', { userId: 'user1' });
      expect(result2.enabled).toBe(true);
    });

    it('should evaluate canary rollout', () => {
      const rollout: RolloutConfig = {
        strategy: 'canary',
        percentage: 10, // 10% canary
      };

      manager.upsertFlag({
        id: 'canary-flag',
        name: 'Canary Flag',
        enabled: true,
        rollout,
      });

      const results = [];
      for (let i = 0; i < 100; i++) {
        const result = manager.evaluate('canary-flag', { userId: `user${i}` });
        if (result.enabled) results.push(result);
      }

      // Roughly 10% should be enabled (allow ±10% variance)
      expect(results.length).toBeGreaterThan(0);
      expect(results.length).toBeLessThan(20);
    });
  });

  describe('Flag Inheritance and Overrides', () => {
    it('should inherit conditions from parent flag', () => {
      // Create parent flag with conditions
      manager.upsertFlag({
        id: 'parent-flag',
        name: 'Parent Flag',
        enabled: true,
        conditions: [{ type: 'group', operator: 'eq', value: 'premium' }],
      });

      // Create child flag that enables itself and inherits parent conditions
      manager.upsertFlag({
        id: 'child-flag',
        name: 'Child Flag',
        parentId: 'parent-flag',
        enabled: true, // Child explicitly enables itself
      });

      // Child should inherit parent's conditions
      const result = manager.evaluate('child-flag', { groupId: 'premium' });
      expect(result.enabled).toBe(true);
      expect(result.inheritedFrom).toBe('parent-flag');

      // Without meeting parent's inherited conditions
      const result2 = manager.evaluate('child-flag', { groupId: 'free' });
      expect(result2.enabled).toBe(false);
    });

    it('should allow child to override parent enabled state', () => {
      manager.upsertFlag({
        id: 'parent-flag',
        name: 'Parent Flag',
        enabled: false,
      });

      manager.upsertFlag({
        id: 'child-flag',
        name: 'Child Flag',
        parentId: 'parent-flag',
        enabled: true, // Override parent
      });

      const result = manager.evaluate('child-flag');
      expect(result.enabled).toBe(true);
      expect(result.inheritedFrom).toBe('parent-flag');
    });

    it('should apply flag-level overrides based on conditions', () => {
      const overrides: FlagOverride[] = [
        {
          condition: { type: 'user', operator: 'eq', value: 'admin' },
          enabled: true,
        },
      ];

      manager.upsertFlag({
        id: 'override-flag',
        name: 'Override Flag',
        enabled: false,
        overrides,
      });

      // Admin user should have flag enabled due to override
      const adminResult = manager.evaluate('override-flag', { userId: 'admin' });
      expect(adminResult.enabled).toBe(true);

      // Regular user should see flag disabled
      const userResult = manager.evaluate('override-flag', { userId: 'user1' });
      expect(userResult.enabled).toBe(false);
    });

    it('should get flag hierarchy', () => {
      manager.upsertFlag({ id: 'parent', name: 'Parent', enabled: true });
      manager.upsertFlag({ id: 'child1', name: 'Child 1', parentId: 'parent' });
      manager.upsertFlag({ id: 'child2', name: 'Child 2', parentId: 'parent' });

      const hierarchy = manager.getFlagHierarchy('parent');
      expect(hierarchy.parent).toBeUndefined();
      expect(hierarchy.children).toHaveLength(2);
      expect(hierarchy.children.map((c) => c.id)).toContain('child1');
      expect(hierarchy.children.map((c) => c.id)).toContain('child2');

      const childHierarchy = manager.getFlagHierarchy('child1');
      expect(childHierarchy.parent?.id).toBe('parent');
      expect(childHierarchy.children).toHaveLength(0);
    });
  });

  describe('Audit Logging', () => {
    it('should log flag creation', () => {
      manager.upsertFlag(
        {
          id: 'new-flag',
          name: 'New Flag',
          enabled: true,
        },
        'admin-user'
      );

      const auditLog = manager.getAuditLog({ flagId: 'new-flag', action: 'created' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.actor).toBe('admin-user');
    });

    it('should log flag updates with changes', () => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: false }, 'user1');
      manager.upsertFlag({ id: 'flag', name: 'Updated Flag', enabled: true }, 'user2');

      const auditLog = manager.getAuditLog({ flagId: 'flag', action: 'updated' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.actor).toBe('user2');
      expect(auditLog[0]?.changes?.name).toEqual({ old: 'Flag', new: 'Updated Flag' });
      expect(auditLog[0]?.changes?.enabled).toEqual({ old: false, new: true });
    });

    it('should log flag deletions', () => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: true });
      manager.deleteFlag('flag', 'admin');

      const auditLog = manager.getAuditLog({ flagId: 'flag', action: 'deleted' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.actor).toBe('admin');
    });

    it('should log flag evaluations when enabled', () => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: true });
      manager.evaluate('flag', { userId: 'user1' });

      const auditLog = manager.getAuditLog({ flagId: 'flag', action: 'evaluated' });
      expect(auditLog).toHaveLength(1);
      expect(auditLog[0]?.context?.userId).toBe('user1');
      expect(auditLog[0]?.result?.enabled).toBe(true);
    });

    it('should filter audit log by actor', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true }, 'admin');
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: true }, 'user');

      const adminLog = manager.getAuditLog({ actor: 'admin' });
      expect(adminLog).toHaveLength(1);
      expect(adminLog[0]?.flagId).toBe('flag1');
    });

    it('should filter audit log by timestamp range', () => {
      const start = Date.now();
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });

      const middle = Date.now();
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: true });

      const end = Date.now();

      const log = manager.getAuditLog({ fromTimestamp: middle, toTimestamp: end });
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log.every((entry) => entry.timestamp >= middle && entry.timestamp <= end)).toBe(true);
    });

    it('should limit audit log size', () => {
      const smallManager = new FeatureFlagManager({ maxAuditLogSize: 5 });

      // Create more flags than the limit
      for (let i = 0; i < 10; i++) {
        smallManager.upsertFlag({ id: `flag${i}`, name: `Flag ${i}`, enabled: true });
      }

      const auditLog = smallManager.getAuditLog();
      expect(auditLog.length).toBeLessThanOrEqual(5);
    });

    it('should clear audit log', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: true });

      expect(manager.getAuditLog().length).toBeGreaterThan(0);

      manager.clearAuditLog();
      expect(manager.getAuditLog()).toHaveLength(0);
    });
  });

  describe('Bulk Operations', () => {
    it('should evaluate all flags', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: false });

      const results = manager.evaluateAll({ userId: 'user1' });
      expect(results.size).toBe(2);
      expect(results.get('flag1')?.enabled).toBe(true);
      expect(results.get('flag2')?.enabled).toBe(false);
    });

    it('should export flags configuration', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: false });

      const exported = manager.exportFlags();
      expect(exported.flags).toHaveLength(2);
      expect(exported.metadata.flagCount).toBe(2);
      expect(exported.metadata.exportedAt).toBeInstanceOf(Date);
    });

    it('should import flags configuration', () => {
      const config = {
        flags: [
          { id: 'flag1', name: 'Flag 1', enabled: true, createdAt: new Date(), updatedAt: new Date() },
          { id: 'flag2', name: 'Flag 2', enabled: false, createdAt: new Date(), updatedAt: new Date() },
        ],
        metadata: {
          exportedAt: new Date(),
          flagCount: 2,
        },
      };

      manager.importFlags(config);
      expect(manager.getAllFlags()).toHaveLength(2);
      expect(manager.getFlag('flag1')?.enabled).toBe(true);
    });

    it('should get flags by metadata', () => {
      manager.upsertFlag({ id: 'flag1', name: 'Flag 1', enabled: true, metadata: { category: 'billing' } });
      manager.upsertFlag({ id: 'flag2', name: 'Flag 2', enabled: true, metadata: { category: 'auth' } });
      manager.upsertFlag({ id: 'flag3', name: 'Flag 3', enabled: true, metadata: { category: 'billing' } });

      const billingFlags = manager.getFlagsByMetadata('category', 'billing');
      expect(billingFlags).toHaveLength(2);
      expect(billingFlags.map((f) => f.id).sort()).toEqual(['flag1', 'flag3']);
    });
  });

  describe('Event Emitters', () => {
    it('should emit flag:upserted event', (done) => {
      manager.once('flag:upserted', (flag: FeatureFlag) => {
        expect(flag.id).toBe('new-flag');
        done();
      });

      manager.upsertFlag({ id: 'new-flag', name: 'New Flag', enabled: true });
    });

    it('should emit flag:deleted event', (done) => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: true });

      manager.once('flag:deleted', (flagId: string) => {
        expect(flagId).toBe('flag');
        done();
      });

      manager.deleteFlag('flag');
    });

    it('should emit flag:killed event', (done) => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: true });

      manager.once('flag:killed', (data: { flagId: string; reason: string; actor?: string }) => {
        expect(data.flagId).toBe('flag');
        expect(data.reason).toBe('Emergency');
        done();
      });

      manager.killFlag('flag', 'Emergency');
    });

    it('should emit flag:restored event', (done) => {
      manager.upsertFlag({ id: 'flag', name: 'Flag', enabled: true });
      manager.killFlag('flag', 'Test');

      manager.once('flag:restored', (data: { flagId: string; actor?: string }) => {
        expect(data.flagId).toBe('flag');
        done();
      });

      manager.restoreFlag('flag');
    });
  });
});

describe('ABTestingFramework', () => {
  let framework: ABTestingFramework;

  beforeEach(() => {
    framework = new ABTestingFramework();
  });

  it('should create an A/B test', () => {
    framework.createABTest({
      id: 'button-color-test',
      name: 'Button Color Test',
      variants: [
        { id: 'control', name: 'Blue Button', weight: 50, implementation: 'blue' },
        { id: 'variant', name: 'Red Button', weight: 50, implementation: 'red' },
      ],
      metrics: ['click_rate', 'conversion_rate'],
    });

    const flag = framework.getManager().getFlag('button-color-test');
    expect(flag).toBeDefined();
    expect(flag?.variants).toHaveLength(2);
  });

  it('should get variant for user', () => {
    framework.createABTest({
      id: 'test',
      name: 'Test',
      variants: [
        { id: 'a', name: 'A', weight: 50, implementation: 'value-a' },
        { id: 'b', name: 'B', weight: 50, implementation: 'value-b' },
      ],
      metrics: [],
    });

    const variant = framework.getVariant('test', 'user1');
    expect(['value-a', 'value-b']).toContain(variant);
  });

  it('should record metrics', () => {
    framework.createABTest({
      id: 'test',
      name: 'Test',
      variants: [
        { id: 'control', name: 'Control', weight: 50, implementation: 'a' },
        { id: 'variant', name: 'Variant', weight: 50, implementation: 'b' },
      ],
      metrics: ['conversion'],
    });

    framework.recordMetric('conversion', 1, { testId: 'test', userId: 'user1', variant: 'control' });
    framework.recordMetric('conversion', 0, { testId: 'test', userId: 'user2', variant: 'control' });
    framework.recordMetric('conversion', 1, { testId: 'test', userId: 'user3', variant: 'variant' });
    framework.recordMetric('conversion', 1, { testId: 'test', userId: 'user4', variant: 'variant' });

    const results = framework.getTestResults('test');
    expect(results.variants.control).toBeDefined();
    expect(results.variants.variant).toBeDefined();
  });

  it('should calculate statistics correctly', () => {
    framework.createABTest({
      id: 'test',
      name: 'Test',
      variants: [{ id: 'control', name: 'Control', weight: 100, implementation: 'a' }],
      metrics: ['value'],
    });

    // Record metrics: [1, 2, 3, 4, 5]
    for (let i = 1; i <= 5; i++) {
      framework.recordMetric('value', i, { testId: 'test', userId: `user${i}`, variant: 'control' });
    }

    const results = framework.getTestResults('test');
    const stats = results.variants.control?.value;

    expect(stats?.count).toBe(5);
    expect(stats?.mean).toBe(3);
    expect(stats?.median).toBe(3);
    expect(stats?.stdDev).toBeCloseTo(1.414, 2); // √2 ≈ 1.414
  });

  it('should aggregate metrics by variant', () => {
    framework.createABTest({
      id: 'test',
      name: 'Test',
      variants: [
        { id: 'a', name: 'A', weight: 50, implementation: 'a' },
        { id: 'b', name: 'B', weight: 50, implementation: 'b' },
      ],
      metrics: ['clicks'],
    });

    framework.recordMetric('clicks', 10, { testId: 'test', userId: 'user1', variant: 'a' });
    framework.recordMetric('clicks', 15, { testId: 'test', userId: 'user2', variant: 'a' });
    framework.recordMetric('clicks', 20, { testId: 'test', userId: 'user3', variant: 'b' });
    framework.recordMetric('clicks', 25, { testId: 'test', userId: 'user4', variant: 'b' });

    const results = framework.getTestResults('test');

    expect(results.variants.a?.clicks.mean).toBe(12.5);
    expect(results.variants.b?.clicks.mean).toBe(22.5);
  });

  it('should use shared flag manager', () => {
    const sharedManager = new FeatureFlagManager();
    const framework1 = new ABTestingFramework(sharedManager);
    const framework2 = new ABTestingFramework(sharedManager);

    framework1.createABTest({
      id: 'shared-test',
      name: 'Shared Test',
      variants: [{ id: 'control', name: 'Control', weight: 100, implementation: 'value' }],
      metrics: [],
    });

    // Both frameworks should see the same flag
    expect(framework1.getManager().getFlag('shared-test')).toBeDefined();
    expect(framework2.getManager().getFlag('shared-test')).toBeDefined();
  });
});
