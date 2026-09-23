/**
 * A daemon's memory that was the apps' memory.
 *
 * `omnitron status` printed «Memory» in the «Omnitron Daemon» box — 1.8 GB,
 * then 2.4 GB — for a daemon whose own RSS was 233 MB and 254 MB. The field
 * was apps AND daemon: 2,808,774,656 = apps 2,555,019,264 + daemon
 * 253,755,392, byte for byte. The two are now answered apart, and the sum is
 * kept for readers that know only it.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'reflect-metadata';

import { DaemonRpcService } from '../../src/daemon/daemon.rpc-service.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the daemon status', () => {
  it('answers the daemon\'s own memory apart from the apps\'', async () => {
    const apps = [{ cpu: 1, memory: 1_000_000_000 }, { cpu: 2, memory: 555_019_264 }];
    const rpc = new DaemonRpcService({ list: () => apps } as never, {} as never, {} as never, {} as never, {} as never);

    const status = await rpc.status();

    expect(status.appsMemory).toBe(1_555_019_264);
    expect(status.daemonMemory).toBeGreaterThan(0);
    expect(status.totalMemory).toBe(status.appsMemory! + status.daemonMemory!);
  });

  it('is printed as the daemon\'s RSS, and the apps\' on their own line', () => {
    const source = fs.readFileSync(path.join(here, '../../src/commands/status.ts'), 'utf8');
    expect(source).toMatch(/formatMemoryColored\(status\.daemonMemory\)\} daemon \(RSS\)/);
    expect(source).toMatch(/formatMemoryColored\(status\.appsMemory\)\} across/);
  });
});
