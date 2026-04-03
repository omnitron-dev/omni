/**
 * Row-Level Security (RLS) Exports
 *
 * Import from '@omnitron-dev/titan/module/database/rls' for tree-shaking.
 *
 * @module @omnitron-dev/titan/module/database/rls
 */

// ============================================================================
// RLS Decorators
// ============================================================================

export {
  Policy,
  Allow,
  Deny,
  Filter,
  BypassRLS,
  getRLSPolicyMetadata,
  getRLSAllowRules,
  getRLSDenyRules,
  getRLSFilters,
  getRLSBypassedMethods,
  isRLSEnabled,
} from '../database.decorators.js';

export type { RLSPolicyConfig, RLSRuleConfig, RLSFilterConfig } from '../database.decorators.js';

// ============================================================================
// @kysera/rls Core
// ============================================================================

export { defineRLSSchema, allow, deny, filter, rlsPlugin } from '@kysera/rls';
export { rlsContext, createRLSContext, withRLSContext, withRLSContextAsync } from '@kysera/rls';

export type {
  RLSPluginOptions,
  RLSSchema,
  TableRLSConfig,
  PolicyCondition,
  FilterCondition,
  Operation as RLSOperation,
  RLSContext,
  RLSAuthContext,
} from '@kysera/rls';

// ============================================================================
// Auth Bridge & Guard Decorators (from netron/auth)
// ============================================================================

export {
  mapAuthToRLSContext,
  mapAuthToRLSAuthContext,
  withAuthRLSContext,
  withSystemRLSContext,
} from '@omnitron-dev/titan/netron/auth';

export type { AuthToRLSOptions } from '@omnitron-dev/titan/netron/auth';

export {
  RequireRlsContext,
  RequireUser,
  RequireTenant,
  RequireRole,
  RequirePermission,
  RequireAdmin,
  RlsProtected,
  RlsGuardError,
  getRlsGuardRequirements,
} from '@omnitron-dev/titan/netron/auth';

export type { RequireRlsContextOptions } from '@omnitron-dev/titan/netron/auth';
