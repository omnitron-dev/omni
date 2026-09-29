/**
 * The host's disk, as omnitron sees it: free and total bytes of the
 * filesystem that holds OMNITRON_HOME — the release store, the stacks'
 * volumes and, on a single-disk host, the container engine and the test
 * runners' temp copies too.
 *
 * One reading for `omnitron doctor` and the alert evaluator. It was doctor's
 * alone, and doctor runs when somebody runs it: the master's disk reached 99%
 * and stopped the container engine three times (2026-07-01, 09-14, 09-29)
 * with nobody warned before — the last at 21 GiB free of 1.8 TiB, 112 GB of it
 * dead vitest copies in ~/.tmp.
 */
import fs from 'node:fs';

import { OMNITRON_HOME } from '../config/defaults.js';

/** Free (available to this user) and total bytes, or null when unreadable. */
export async function diskAtHome(home: string = OMNITRON_HOME): Promise<{ free: number; total: number } | null> {
  try {
    const st = await fs.promises.statfs(home);
    return { free: st.bavail * st.bsize, total: st.blocks * st.bsize };
  } catch {
    // No statfs, or the home does not exist yet. Neither is a disk fault.
    return null;
  }
}
