import os from 'os';
import cluster from 'cluster';
import { defer } from '@devgrid/common';

import { ProcessOptions } from './types';

let options: ProcessOptions | null = null;
const optionsDeferred = defer();

/**
 * Механизм контроля рестартов
 */
const restarts: Map<number, number> = new Map(); // `pid -> restartCount`

/**
 * Тайм-аут ожидания параметров от `omnitron-демона`
 */
setTimeout(() => {
  if (!options) {
    console.error('❌ Timeout: No options received from Omnitron Daemon.');
    process.exit(1);
  }
}, 5000);

process.on('message', (msg: { type: string;[key: string]: any }) => {
  if (msg.type === 'options') {
    options = msg.options as ProcessOptions;
    optionsDeferred.resolve?.();
  }
});

/**
 * Функция для запуска `fork`
 */
function startFork(): void {
  import(options!.script)
    .then(() => console.log(`✅ Process "${options!.script}" started.`))
    .catch((err) => {
      console.error(`❌ Failed to start "${options!.script}":`, err);
      process.exit(1);
    });
}

/**
 * Функция для запуска `cluster`
 */
function startCluster(): void {
  if (cluster.isPrimary) {
    // console.log(`🔹 Cluster mode: Starting "${options!.script}" with ${options!.instances || os.cpus().length} workers...`);

    for (let i = 0; i < (options!.instances || os.cpus().length); i++) {
      cluster.fork();
    }

    cluster.on('exit', (worker, code) => {
      console.log(`⚠️ Worker ${worker.process.pid} exited with code ${code}. Restarting...`);

      const restartCount = (restarts.get(worker.process.pid!) || 0) + 1;

      if (options!.autorestart && restartCount < options!.maxRestarts!) {
        restarts.set(worker.process.pid!, restartCount);
        setTimeout(() => cluster.fork(), options!.restartDelay || 1000);
      }
    });
  } else {
    import(options!.script)
      .then(() => console.log(`✅ Worker ${process.pid} started.`))
      .catch((err) => {
        console.error(`❌ Worker ${process.pid} failed to start:`, err);
        process.exit(1);
      });
  }
}

async function main() {
  await optionsDeferred.promise;

  if (options?.execMode === 'fork') {
    startFork();
  } else if (options?.execMode === 'cluster') {
    startCluster();
  } else {
    console.error('❌ Invalid execMode. Supported: fork, cluster.');
  }
}

main();
