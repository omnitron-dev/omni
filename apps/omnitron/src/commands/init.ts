/**
 * omnitron init — Scaffold omnitron.config.ts
 */

import fs from 'node:fs';
import path from 'node:path';
import { log, confirm } from '@xec-sh/kit';

const CONFIG_TEMPLATE = `import { defineEcosystem } from '@omnitron-dev/omnitron';

export default defineEcosystem({
  apps: [
    {
      name: 'main',
      script: './apps/main/src/main.ts',
      critical: true,
    },
    {
      name: 'storage',
      script: './apps/storage/src/main.ts',
      dependsOn: ['main'],
    },
    {
      name: 'priceverse',
      script: './apps/priceverse/src/main.ts',
    },
    {
      name: 'paysys',
      script: './apps/paysys/src/main.ts',
      dependsOn: ['main'],
    },
    {
      name: 'messaging',
      script: './apps/messaging/src/main.ts',
      dependsOn: ['main'],
    },
  ],

  supervision: {
    strategy: 'one_for_one',
    maxRestarts: 5,
    window: 60_000,
    backoff: { type: 'exponential', initial: 1_000, max: 30_000, factor: 2 },
  },

  monitoring: {
    healthCheck: { interval: 15_000, timeout: 5_000 },
    metrics: { interval: 5_000, retention: 3600 },
  },

  logging: {
    directory: '~/.omnitron/logs/',
    maxSize: '50mb',
    maxFiles: 10,
    compress: true,
  },

  daemon: {
    port: 9700,
    host: '127.0.0.1',
    pidFile: '~/.omnitron/daemon.pid',
    stateFile: '~/.omnitron/state.json',
  },

  env: 'development',
});
`;

export async function initCommand(): Promise<void> {
  const configPath = path.resolve(process.cwd(), 'omnitron.config.ts');

  if (fs.existsSync(configPath)) {
    const overwrite = await confirm({ message: 'omnitron.config.ts already exists. Overwrite?' });
    if (!overwrite) {
      log.info('Aborted');
      return;
    }
  }

  fs.writeFileSync(configPath, CONFIG_TEMPLATE, 'utf-8');
  log.success('Created omnitron.config.ts');
}
