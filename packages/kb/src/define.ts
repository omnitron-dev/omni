import type { IKbConfig } from './core/types.js';

/**
 * Define knowledge base configuration for a package.
 * Used in each package's kb/kb.config.ts to declare what to extract and index.
 *
 * @example
 * ```typescript
 * // packages/titan-redis/kb/kb.config.ts
 * import { defineKnowledge } from '@omnitron-dev/kb';
 *
 * export default defineKnowledge({
 *   module: 'titan-redis',
 *   name: 'Titan Redis Module',
 *   tags: ['redis', 'cache', 'pubsub'],
 *   extract: {
 *     symbols: true,
 *     decorators: ['Injectable', 'Module', 'Inject'],
 *     entryPoints: ['src/index.ts'],
 *   },
 *   specs: './specs',
 *   relationships: {
 *     extends: ['titan/nexus'],
 *     integrates: ['titan/netron'],
 *   },
 * });
 * ```
 */
export function defineKnowledge(config: IKbConfig): IKbConfig {
  const defaults = {
    specs: './specs' as const,
    extract: {
      symbols: true as const,
      decorators: ['Injectable', 'Module', 'Inject', 'Service', 'Public'],
      entryPoints: ['src/index.ts'],
    },
  };

  return {
    ...defaults,
    ...config,
    extract: {
      ...defaults.extract,
      ...config.extract,
    },
  };
}
