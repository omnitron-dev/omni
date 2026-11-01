import { isIP } from 'node:net';

/** Hostnames beginning with 127. are not proof of a loopback address. */
export function isLoopbackHost(host: string | undefined): boolean {
  if (host === undefined) return true;
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '::1' || normalized === '[::1]' ||
    (isIP(normalized) === 4 && normalized.split('.')[0] === '127');
}

/** Await this before registering public ingress; uncertainty refuses publication. */
export async function assertSafeNetworkPublication(
  hosts: readonly (string | undefined)[],
  hasSeededCredential: () => Promise<boolean>,
): Promise<void> {
  if (hosts.every(isLoopbackHost)) return;
  let seeded: boolean;
  try { seeded = await hasSeededCredential(); }
  catch (cause) {
    throw new Error('Network publication refused: administrator credential policy could not be verified', { cause });
  }
  if (seeded) {
    throw new Error('Network publication refused: change the seeded administrator password through a loopback Console before publishing this daemon');
  }
}
