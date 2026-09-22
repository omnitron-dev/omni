/**
 * Nothing checked that the artifact that arrived is the one that was sent.
 *
 * The remote deployment scp's a tarball to the node and then, on the very
 * next line, unpacks it:
 *
 *     await this.scpTransfer(target, artifact.path, remoteFile);
 *     …
 *     tar -xzf <archive>
 *
 * There is a `.artifact-sha256` written afterwards, which reads like the
 * missing check and is not one: it records `artifact.checksum`, the hash of
 * the build INPUTS — the app's sources plus its vendored dependencies — and
 * its job is to let the NEXT deployment decide whether it has anything to
 * do. It says nothing about the bytes on disk, it is written after the
 * unpack rather than before, and it is compared against the next build's
 * inputs rather than against the file.
 *
 * So a truncated transfer — a link that dropped, a full disk on the node, a
 * session killed mid-copy — reaches `tar -xzf`, which fails with whatever
 * tar says about a corrupt archive, and the deployment reports that. A
 * transfer that succeeded partially and happened to end on a record boundary
 * unpacks a subset and reports success.
 *
 * Two numbers travel, not one. A zero-length file with the right sum is
 * impossible; a truncated one with the wrong sum is ordinary, and «sha
 * mismatch» alone does not say whether anything arrived at all. `manifest.ts`
 * already states this rule for a release artifact — this is the code that
 * enforces it at the only place the bytes actually cross a machine boundary.
 *
 * And the check must be able to RUN. `sha256sum` is coreutils and `shasum` is
 * perl; a node can have either, and a node can have neither. A probe that
 * cannot compute the sum must refuse rather than pass — an unverifiable
 * transfer is the thing this exists to catch, not an exemption from it.
 */

import { describe, it, expect } from 'vitest';

import {
  deliveredProbeCommand,
  parseDeliveredProbe,
  checkDelivered,
} from '../../src/release/delivered.js';

const SHA = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

describe('a transfer nobody checked arrived', () => {
  it('accepts a file whose sum and size both match', () => {
    const verdict = checkDelivered(
      { sha256: SHA, bytes: 1_048_576 },
      { sha256: SHA, bytes: 1_048_576 },
    );

    expect(verdict.ok).toBe(true);
  });

  it('names both numbers when the sum is wrong', () => {
    const verdict = checkDelivered({ sha256: SHA, bytes: 1_048_576 }, { sha256: OTHER, bytes: 1_048_576 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.because, 'what was expected').toContain(SHA.slice(0, 12));
    expect(verdict.because, 'what arrived').toContain(OTHER.slice(0, 12));
  });

  it('reports a truncated file as a size, not as a sum', () => {
    // The common failure, and the one a bare «sha mismatch» describes
    // worst: the operator needs to know that 900 KB of 1 MB landed.
    const verdict = checkDelivered({ sha256: SHA, bytes: 1_048_576 }, { sha256: OTHER, bytes: 921_600 });

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.because).toContain('1048576');
    expect(verdict.because).toContain('921600');
  });

  it('refuses a node that could not compute the sum', () => {
    // Neither `sha256sum` nor `shasum` present. Passing here would make
    // the check optional on exactly the machines where it is weakest.
    const verdict = checkDelivered({ sha256: SHA, bytes: 10 }, parseDeliveredProbe(''));

    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.because).toMatch(/could not|no sha256/i);
  });

  it('refuses a file the node does not have at all', () => {
    // `wc -c` on a missing path answers nothing useful; zero bytes with no
    // sum is «it is not there», which must not read as «it is fine».
    const verdict = checkDelivered({ sha256: SHA, bytes: 10 }, parseDeliveredProbe('\n0\n'));

    expect(verdict.ok).toBe(false);
  });

  it('reads what either checksum tool prints', () => {
    // coreutils `sha256sum` and perl `shasum -a 256` both print
    // `<hash>  <path>`; the probe emits the hash alone on its own line and
    // the byte count on the next.
    expect(parseDeliveredProbe(`${SHA}\n1048576\n`)).toEqual({ sha256: SHA, bytes: 1_048_576 });
    // A node that printed the whole tool line is still read correctly.
    expect(parseDeliveredProbe(`${SHA}  /opt/x.tar.gz\n1048576\n`)).toEqual({
      sha256: SHA,
      bytes: 1_048_576,
    });
  });

  it('asks the node with whichever tool it has', () => {
    const cmd = deliveredProbeCommand('/opt/omnitron/x.tar.gz');

    expect(cmd, 'coreutils').toContain('sha256sum');
    expect(cmd, 'perl').toContain('shasum');
    expect(cmd, 'and the size').toContain('wc -c');
    expect(cmd, 'the path is quoted once per use').toContain("'/opt/omnitron/x.tar.gz'");
  });

  it('does not let a path end the quoting', () => {
    // Control: the remote path reaches a shell. A single quote in it must
    // not close the string the probe builds.
    const cmd = deliveredProbeCommand("/opt/o'ops/x.tar.gz");

    expect(cmd).not.toMatch(/'\/opt\/o'ops/);
  });
});

/**
 * The other half: the check has to be REACHED, and reached before the unpack.
 *
 * A decider with no caller is the shape this repository keeps producing —
 * `release/manifest.ts` and `release/publish.ts` are both sitting there with
 * no reader outside their own directory. So this drives the real deployer
 * with a stub executor and watches what it does with the commands.
 */
describe('and the deployment refuses to unpack what did not arrive', () => {
  const ARTIFACT = {
    app: 'main',
    version: '1.2.3',
    path: '/tmp/main-1.2.3.tar.gz',
    size: 1_048_576,
    builtAt: '2026-09-22T00:00:00.000Z',
    checksum: 'inputs-hash-not-the-file',
    tarballSha256: 'a'.repeat(64),
  };

  /** Answers every ssh command, and remembers what it was asked. */
  function executor(probeAnswer: string) {
    const commands: string[] = [];
    return {
      commands,
      uploaded: [] as string[],
      ssh: async (_t: unknown, command: string) => {
        commands.push(command);
        if (command.includes('sha256sum')) return { exitCode: 0, stdout: probeAnswer, stderr: '' };
        return { exitCode: 0, stdout: '', stderr: '' };
      },
      uploadFile: async function (this: { uploaded: string[] }, _t: unknown, local: string) {
        this.uploaded.push(local);
      },
    };
  }

  const silent = {
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
    debug: () => undefined,
  };

  it('stops before tar when the sum does not match', async () => {
    const { RemoteDeployer } = await import('../../src/services/remote-deployer.service.js');
    const exec = executor(`${'b'.repeat(64)}\n1048576\n`);
    const deployer = new RemoteDeployer(silent as never, exec as never);

    const result = await deployer.deployToNode(
      { host: '203.0.113.7', username: 'root' } as never,
      ARTIFACT as never,
      'proj',
      { force: true },
    );

    expect(result.status, 'a deployment that cannot verify its artifact has failed').toBe('failed');
    expect(result.error).toContain('not the one that was sent');
    expect(
      exec.commands.some((c) => c.includes('tar -xzf')),
      'nothing may be unpacked after a failed verification',
    ).toBe(false);
  });

  it('goes on to unpack when it does match', async () => {
    // Control: the check must not refuse a good transfer.
    const { RemoteDeployer } = await import('../../src/services/remote-deployer.service.js');
    const exec = executor(`${ARTIFACT.tarballSha256}\n${ARTIFACT.size}\n`);
    const deployer = new RemoteDeployer(silent as never, exec as never);

    await deployer.deployToNode(
      { host: '203.0.113.7', username: 'root' } as never,
      ARTIFACT as never,
      'proj',
      { force: true },
    );

    expect(exec.commands.some((c) => c.includes('tar -xzf'))).toBe(true);
  });

  it('checks before it unpacks, not after', async () => {
    // Order is the whole point: a verification that runs after `tar` has
    // already written the tree is a report, not a gate.
    const { RemoteDeployer } = await import('../../src/services/remote-deployer.service.js');
    const exec = executor(`${ARTIFACT.tarballSha256}\n${ARTIFACT.size}\n`);
    const deployer = new RemoteDeployer(silent as never, exec as never);

    await deployer.deployToNode(
      { host: '203.0.113.7', username: 'root' } as never,
      ARTIFACT as never,
      'proj',
      { force: true },
    );

    const probeAt = exec.commands.findIndex((c) => c.includes('sha256sum'));
    const tarAt = exec.commands.findIndex((c) => c.includes('tar -xzf'));

    expect(probeAt, 'the probe ran').toBeGreaterThanOrEqual(0);
    expect(tarAt, 'the unpack ran').toBeGreaterThanOrEqual(0);
    expect(probeAt).toBeLessThan(tarAt);
  });
});
