import type { IKbModuleConfig } from '../core/types.js';

// Titan DI tokens
const KB_CONFIG = Symbol.for('titan:kb:config');
const KB_SERVICE = Symbol.for('titan:kb:service');
const KB_STORE = Symbol.for('titan:kb:store');

export { KB_CONFIG, KB_SERVICE, KB_STORE };

/**
 * Titan Nexus DI module for the Knowledge Base.
 *
 * Usage:
 * ```typescript
 * import { KnowledgeBaseModule } from '@omnitron-dev/kb/titan';
 *
 * @Module({
 *   imports: [KnowledgeBaseModule.forRoot({
 *     dbPath: '~/.omnitron/kb.db',
 *     root: '/path/to/monorepo',
 *     autoIndex: true,
 *   })],
 * })
 * export class DaemonModule {}
 * ```
 *
 * This module is a plain object factory (not using Titan decorators directly)
 * to avoid circular dependencies. The consuming app's DI container
 * will handle registration.
 */
export const KnowledgeBaseModule = {
  forRoot(config: IKbModuleConfig) {
    return {
      module: 'KnowledgeBaseModule',
      providers: [
        {
          provide: KB_CONFIG,
          useValue: config,
        },
        {
          provide: KB_STORE,
          useFactory: async () => {
            const { SurrealKbStore } = await import('../surreal/client.js');
            const store = new SurrealKbStore({
              url: config.dbPath.startsWith('ws')
                ? config.dbPath
                : `surrealkv://${config.dbPath}`,
            });
            return store;
          },
          scope: 'singleton',
        },
        {
          provide: KB_SERVICE,
          useFactory: async (store: any) => {
            const { KnowledgeBaseService } = await import('./kb.service.js');
            return new KnowledgeBaseService(config, store);
          },
          inject: [KB_STORE],
          scope: 'singleton',
        },
      ],
      exports: [KB_SERVICE, KB_STORE, KB_CONFIG],
    };
  },
};
