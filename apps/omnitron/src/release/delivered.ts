/**
 * What arrived on the node, checked against what was sent.
 *
 * The remote deployment scp's a tarball and unpacks it on the next line.
 * There is a `.artifact-sha256` beside it that reads like the missing check
 * and is not one: it records `artifact.checksum`, the hash of the build
 * INPUTS — the app's sources plus its vendored dependencies — so the NEXT
 * deployment can tell whether it has anything to do. It is written after the
 * unpack, and it is compared against the next build's inputs rather than
 * against the bytes on disk. Nothing, anywhere, asks whether the file that
 * landed is the file that left.
 *
 * TWO NUMBERS, not one. A zero-length file with the right sum is impossible;
 * a truncated one with the wrong sum is ordinary, and «sha mismatch» alone
 * does not say whether anything arrived at all. `release/manifest.ts` states
 * the rule for a release artifact; this is where it meets the only moment the
 * bytes actually cross a machine boundary.
 *
 * AND THE CHECK MUST BE ABLE TO RUN. `sha256sum` is coreutils, `shasum` is
 * perl, and a node can have either or neither. A probe that cannot compute
 * the sum REFUSES: an unverifiable transfer is the thing this exists to
 * catch, not an exemption from it.
 */

/** What the master knows about the file it sent. */
export interface ExpectedDelivery {
  readonly sha256: string;
  readonly bytes: number;
}

/** What the node was able to say about the file it has. */
export interface DeliveredProbe {
  readonly sha256: string | null;
  readonly bytes: number | null;
}

export type DeliveryVerdict = { ok: true } | { ok: false; because: string };

/** Escape for use inside a single-quoted shell argument. */
function quote(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

/**
 * Ask the node for the sum and the size of one file, in that order, one per
 * line.
 *
 * Both tools print `<hash>  <path>`; `cut` takes the hash. Neither present
 * means the first line is empty, which `parseDeliveredProbe` reports as «no
 * sum» rather than as a sum of nothing. `wc -c <` rather than `wc -c` so the
 * output is the number alone.
 */
export function deliveredProbeCommand(remoteFile: string): string {
  const f = quote(remoteFile);
  return (
    `if command -v sha256sum >/dev/null 2>&1; then sha256sum ${f} | cut -d' ' -f1; ` +
    `elif command -v shasum >/dev/null 2>&1; then shasum -a 256 ${f} | cut -d' ' -f1; ` +
    `else echo ''; fi; ` +
    `wc -c < ${f} 2>/dev/null || echo ''`
  );
}

/** Read the two lines back, tolerating a node that printed the whole tool line. */
export function parseDeliveredProbe(stdout: string): DeliveredProbe {
  const lines = stdout.split('\n').map((l) => l.trim());
  const sumLine = lines.find((l) => /^[0-9a-f]{64}\b/.test(l));
  const sha256 = sumLine ? (sumLine.match(/^[0-9a-f]{64}/)?.[0] ?? null) : null;

  // The size is a line that is only digits. Taken from the END, because the
  // sum line can carry a path with digits in it.
  const sizeLine = [...lines].reverse().find((l) => /^\d+$/.test(l));
  const bytes = sizeLine === undefined ? null : Number(sizeLine);

  return { sha256, bytes };
}

export function checkDelivered(expected: ExpectedDelivery, delivered: DeliveredProbe): DeliveryVerdict {
  // Said first, because everything below assumes there are numbers to
  // compare. A node that cannot answer is not a node whose file is fine.
  if (!delivered.sha256) {
    return {
      ok: false,
      because:
        `the node could not compute a sha256 for the artifact — neither sha256sum nor shasum ` +
        `answered, so the transfer cannot be verified (expected ${expected.sha256}, ` +
        `${expected.bytes} bytes)`,
    };
  }

  if (delivered.sha256 === expected.sha256 && delivered.bytes === expected.bytes) {
    return { ok: true };
  }

  // Both numbers in the refusal. The size is what says «a link dropped
  // partway» as against «a different file entirely», and the operator
  // reads the difference, not the sum.
  const size =
    delivered.bytes === null
      ? 'the node reported no size'
      : `${delivered.bytes} bytes arrived of ${expected.bytes}`;

  return {
    ok: false,
    because:
      `the artifact on the node is not the one that was sent: ${size}; ` +
      `expected sha256 ${expected.sha256}, got ${delivered.sha256}`,
  };
}
