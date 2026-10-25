import { readFile } from 'node:fs/promises';
import { log } from '@xec-sh/kit';
import { createDaemonClient, LONG_REQUEST_TIMEOUT } from '../daemon/daemon-client.js';
import { emitError, emitJson } from './output.js';
import type { IOmnitronInfraService } from '../shared/dto/services.js';

/** The host daemon owns publication; CLI and Webapp call the same authenticated API. */
export async function hostIngressCommand(operation: 'configure' | 'apply' | 'check' | 'remove' | 'status' | 'recover', filename?: string): Promise<void> {
  const client = createDaemonClient(undefined, LONG_REQUEST_TIMEOUT);
  try {
    const input = filename ? JSON.parse(await readFile(filename, 'utf8')) : undefined;
    const service = await client.service<IOmnitronInfraService>('OmnitronInfra');
    const result = operation === 'configure' ? await service.configureHostIngress(input)
      : operation === 'check' ? await service.checkHostIngress(input)
      : operation === 'apply' ? await service.applyHostIngress(input)
      : operation === 'remove' ? await service.removeHostIngress(input)
      : operation === 'recover' ? await service.recoverHostIngress()
      : await service.getHostIngress();
    if (!emitJson(result)) log.info(JSON.stringify(result, null, 2));
  } catch (error) { emitError(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
  finally { await client.disconnect(); }
}
