import { Module } from '@omnitron-dev/titan/decorators';
import { createToken, type Token, type DynamicModule } from '@omnitron-dev/titan/nexus';
import { S3Adapter } from './s3.adapter.js';
import { LocalAdapter } from './local.adapter.js';
import type { StorageAdapter } from './adapter.interface.js';
export const STORAGE_ADAPTER: Token<StorageAdapter> = createToken<StorageAdapter>('StorageAdapter');
/** Uses Titan config/logger. Only the selected backend is initialized. */
@Module()
export class StorageModule {
  static forRoot(options: { backend: 's3' | 'local' }): DynamicModule {
    const adapter = options.backend === 's3' ? S3Adapter : options.backend === 'local' ? LocalAdapter : null;
    if (!adapter) throw Error('Unknown storage backend');
    return { module: StorageModule, providers: [[STORAGE_ADAPTER, { useClass: adapter }]], exports: [STORAGE_ADAPTER] };
  }
}
