import path from 'path';
import { RemotePeer } from '@devgrid/netron';

import { Runtime } from '../../runtime';
import { ProcessOptions, IProcessManager } from '../../services';

/**
 * Starts a process based on CLI arguments or a config file.
 */
export default async function start(app: string, options: any): Promise<void> {
  console.log('start', app, options);

  const peer = Runtime.get().get('peer') as RemotePeer;
  const iProcessManager = (await peer.queryInterface('process-manager')) as IProcessManager;

  const processConfig: ProcessOptions = {
    name: app,
    script: path.resolve(app),
    args: options.args || [],
    env: options.env ? Object.fromEntries(options.env.map((e: string) => e.split('='))) : {},
    execMode: options.cluster ? 'cluster' : 'fork',
    instances: options.instances || 1,
    autorestart: options.autorestart !== undefined ? options.autorestart : true,
    maxRestarts: options.maxRestarts || 5,
    restartDelay: options.restartDelay || 1000,
    maxMemoryRestart: options.maxMemoryRestart || '512M',
    interpreter: options.interpreter || 'node',
  };

  await iProcessManager.start(app, processConfig);
}
