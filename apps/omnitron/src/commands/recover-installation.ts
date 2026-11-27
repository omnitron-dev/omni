import { userInfo } from 'node:os';
import { join } from 'node:path';
import { RuntimeInstallation } from '../daemon/runtime-installation.js';

export async function recoverEnrolledInstallation(options: { check?: boolean; review?: string }) {
  if (process.platform !== 'linux') throw Error('Enrolled installation recovery requires Linux');
  if (Boolean(options.check) === (options.review !== undefined) ||
      (options.review !== undefined && !/^[0-9a-f]{64}$/.test(options.review))) throw Error('Choose --check or --review <sha256>');
  const { enterManagedInstance } = await import(new URL('../../data/operations/managed-account.mjs', import.meta.url).href);
  // The maintenance image can be private to root. Resolve its dependencies before entering the enrolled account.
  await RuntimeInstallation.preloadExclusive();
  const { home } = enterManagedInstance(join(userInfo().homedir, '.omnitron')) as { home: string };
  const runtime = options.check ? await RuntimeInstallation.openReadOnly(home) : await RuntimeInstallation.open(home, { existing: true });
  if (!runtime) throw Error('The enrolled account has no runtime registry');
  try { return runtime.recoverAbandonedInstallation(options.review); }
  finally { await runtime.close(); }
}
