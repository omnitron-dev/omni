/**
 * A gateway one tool could not find.
 *
 * The sample tools look the stand's containers up by name, defaulting to the
 * developer's (`sample-dev-postgres`, `sample-dev-gateway`); on a node this master
 * names them `<prefix>-…`. Two tables did that: the attestation's, with the
 * gateway, and the operator-account tool's, without. When signup began
 * reading the legal texts in force from the gateway (sample c0dcf556),
 * `omnitron stack account sample test --username cspprobe` failed on the test
 * node with «No such container: sample-dev-gateway» and made no account
 * (2026-09-25, 01:30Z) — while the attestation, run a minute earlier on the
 * same node, read the same texts without trouble.
 *
 * Held here: every command either tool runs on a node names all three of the
 * stand's containers as they are there, and both tools name them the same.
 */
import { describe, expect, it } from 'vitest';

import {
  operatorAccountCommand,
  operatorAccountRemoveCommand,
  operatorAccountShowCommand,
  operatorCensusCommand,
} from '../../src/project/operator-account.js';
import { attestationCommand } from '../../src/release/attest-on-node.js';

const at = { remoteDir: '/opt/omnitron/operator/sample', containerPrefix: 'sample-test' };

/** The `NAME=value` assignments a command sets before its tool. */
function assignments(command: string): string[] {
  return [...command.matchAll(/\b(SAMPLE_[A-Z_]+_CONTAINER)=('[^']*'|\S+)/g)].map((m) => `${m[1]}=${m[2]!.replace(/'/g, '')}`).sort();
}

const ALL_THREE = [
  'SAMPLE_GATEWAY_CONTAINER=sample-test-gateway',
  'SAMPLE_PG_CONTAINER=sample-test-postgres',
  'SAMPLE_REDIS_CONTAINER=sample-test-redis',
];

describe('every tool run on a node finds the stand by its names there', () => {
  it('the operator-account tool names the gateway — make, show, census, remove', () => {
    for (const command of [
      operatorAccountCommand({ ...at, username: 'cspprobe', role: 'superadmin', sealTo: 'AAAA' } as never),
      operatorAccountShowCommand({ ...at, username: 'cspprobe' }),
      operatorCensusCommand(at),
      operatorAccountRemoveCommand({ ...at, username: 'cspprobe', id: '01a0d55c-02a1-7497-bb1a-060fceb3cac8' }),
    ]) {
      expect(assignments(command)).toEqual(ALL_THREE);
    }
  });

  it('the attestation names the same three, the same way', () => {
    const command = attestationCommand({ remoteDir: '/opt/omnitron/attest/sample', stack: 'test', releaseId: 'sample-x', containerPrefix: 'sample-test' });
    expect(assignments(command)).toEqual(ALL_THREE);
  });
});
