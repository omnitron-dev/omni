/**
 * Storage Module for Orchestron
 * Provides SQLite storage and access to the existing Orchestron storage layer
 */

import { Module, Global } from '@omnitron-dev/titan/nexus';
import { createToken, Token } from '@omnitron-dev/titan';
import { SQLiteStorage } from '../../../storage/sqlite.js';
import { Storage } from '../../../storage/interface.js';
import { CONFIG_SERVICE_TOKEN } from '@omnitron-dev/titan/module/config';
import { LOGGER_SERVICE_TOKEN } from '@omnitron-dev/titan/module/logger';
import * as path from 'path';
import * as fs from 'fs';

// Token for storage service
export const STORAGE_SERVICE_TOKEN: Token<any> = createToken<Storage>('StorageService');

// Storage service wrapper
class StorageService extends SQLiteStorage {
  constructor(
    private configService: any,
    private logger: any
  ) {
    const storagePath = configService?.get('storagePath') || '.orchestron';
    const dbFile = path.join(storagePath, 'orchestron.db');

    // Ensure storage directory exists
    if (!fs.existsSync(storagePath)) {
      fs.mkdirSync(storagePath, { recursive: true });
    }

    super(dbFile);

    logger?.info('StorageService initialized', { dbFile });
  }

  async onModuleInit() {
    await this.initialize();
    this.logger?.info('Storage database initialized');
  }

  async onModuleDestroy() {
    await this.close();
    this.logger?.info('Storage database closed');
  }
}

@Global()
@Module({
  providers: [
    {
      provide: STORAGE_SERVICE_TOKEN,
      useFactory: (configService: any, logger: any) => new StorageService(configService, logger),
      inject: [
        { token: CONFIG_SERVICE_TOKEN, optional: true },
        { token: LOGGER_SERVICE_TOKEN, optional: true }
      ]
    }
  ],
  exports: [STORAGE_SERVICE_TOKEN]
})
export class StorageModule {
  readonly name = 'StorageModule';
  readonly version = '1.0.0';

  async onStart() {
    // Module startup logic
  }

  async onStop() {
    // Module cleanup logic
  }
}