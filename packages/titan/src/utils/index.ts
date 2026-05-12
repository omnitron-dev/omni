/**
 * Titan utility modules.
 *
 * The `deprecation.js` module was removed in the T#77 cleanup pass —
 * its 588 lines of runtime-warning infrastructure (deprecate(),
 * createDeprecatedAlias(), DEPRECATIONS registry, generateMigrationGuide,
 * findDeprecation, isDeprecated, getReplacement, Deprecated decorator,
 * configureDeprecation, resetDeprecationWarnings) had ZERO consumers
 * anywhere in the monorepo. The DEPRECATIONS registry inside it listed
 * symbols (`TitanApplication`, `Method`, `IOnInit`, `IOnDestroy`,
 * `FEATURES`) that no longer existed in the source. Deprecation is now
 * communicated via the `@deprecated` JSDoc tag only.
 *
 * If a runtime deprecation system is needed again, the `Deprecated`
 * decorator from `./decorators/decorator-factory.ts` (re-exported from
 * `./decorators`) is the canonical entry point.
 */

export * from './error-classification.js';
export * from './id.js';
export * from './json.js';
export * from './lru-cache.js';
export * from './port-utils.js';
export * from './resilience.js';

// Rate limiting types moved to @omnitron-dev/titan-ratelimit
export * from './retry.js';
export * from './wheel-timer.js';
export * from './fallback-log.js';
