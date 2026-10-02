import { describe, expect, it } from 'vitest';

import { standContainerAssignments, standContainers } from '../../src/project/stand-containers.js';
import { operatorAccountCommand, probeLeftoversCommand } from '../../src/project/operator-account.js';
import { attestationCommand } from '../../src/release/attest-on-node.js';

describe('project container environment', () => {
  it('keeps the project namespace when a stack chooses a different container prefix', () => {
    expect(standContainers('isolated-west', 'sample')).toEqual({
      SAMPLE_PG_CONTAINER: 'isolated-west-postgres',
      SAMPLE_REDIS_CONTAINER: 'isolated-west-redis',
      SAMPLE_GATEWAY_CONTAINER: 'isolated-west-gateway',
    });
  });

  it('normalizes project names and escapes container names for the shell', () => {
    expect(standContainers('ci-test', 'my-platform')).toHaveProperty('MY_PLATFORM_PG_CONTAINER', 'ci-test-postgres');
    expect(standContainerAssignments("node's stack", 'sample')).toContain("SAMPLE_PG_CONTAINER='node'\\''s stack-postgres'");
    expect(() => standContainers('ci-test', '123')).toThrow('valid environment');
  });

  it('passes the same project namespace to operator, cleanup and attestation tools', () => {
    const at = { projectName: 'sample', containerPrefix: 'isolated-west', remoteDir: '/opt/tools' };
    const commands = [
      operatorAccountCommand({ ...at, username: 'probe', sealTo: 'public-key' }),
      probeLeftoversCommand({ ...at, mode: 'census' }),
      attestationCommand({ ...at, stack: 'test', releaseId: 'sample-release' }),
    ];
    for (const command of commands) {
      expect(command).toContain("SAMPLE_PG_CONTAINER='isolated-west-postgres'");
      expect(command).toContain("SAMPLE_REDIS_CONTAINER='isolated-west-redis'");
      expect(command).toContain("SAMPLE_GATEWAY_CONTAINER='isolated-west-gateway'");
      expect(command).not.toContain('ISOLATED_');
    }
  });
});
