/**
 * Reading `ps` output.
 *
 * Two things live here that were previously inline and inconsistent between
 * the batch path and the single-pid path:
 *
 * **Parsing.** `ps -o pid=,rss=,%cpu=` prints fixed columns, but a pid that
 * has exited between the query and the read prints nothing, and a `ps` under
 * memory pressure can print a partial line. `parseFloat('')` is `NaN`, and a
 * NaN CPU reading renders as `NaN%` in the console and poisons any total it
 * is summed into.
 *
 * **What failure means.** The batch path left its map empty on error, with a
 * comment saying "no reading is honest, a zero reading is not". The
 * single-pid path — used for every classic-mode app — returned
 * `{ cpu: 0, memory: 0 }` on exactly the same failure, and the caller
 * overwrote `handle.lastMetrics` with it. So a `ps` that timed out under
 * load made a running app read as idle, indistinguishable from one that
 * genuinely is. The two paths now agree: absence is `null`.
 */

export interface ProcessSample {
  cpu: number;
  memory: number;
}

/**
 * Parse one `ps` line of the form `<pid> <rss-kb> <cpu-percent>`.
 *
 * @returns null when the line does not carry all three fields as numbers —
 *          a partial line is not a zero reading.
 */
export function parsePsLine(line: string): { pid: number; sample: ProcessSample } | null {
  const [pidText, rssText, cpuText] = line.trim().split(/\s+/);
  const pid = Number.parseInt(pidText ?? '', 10);
  const rssKb = Number.parseInt(rssText ?? '', 10);
  const cpu = Number.parseFloat(cpuText ?? '');

  if (!Number.isFinite(pid) || !Number.isFinite(rssKb) || !Number.isFinite(cpu)) return null;
  if (pid <= 0 || rssKb < 0 || cpu < 0) return null;

  return { pid, sample: { cpu, memory: rssKb * 1024 } };
}

/** Parse the whole of a `ps` batch response. Unreadable lines are skipped. */
export function parsePsBatch(output: string): Map<number, ProcessSample> {
  const out = new Map<number, ProcessSample>();
  for (const line of output.split('\n')) {
    const parsed = parsePsLine(line);
    if (parsed) out.set(parsed.pid, parsed.sample);
  }
  return out;
}

/**
 * Fold a fresh sample into what is already known about a process.
 *
 * `null` means the sampler could not read it — which is not the same as
 * reading zero, and must not overwrite a previous reading with one. A
 * process that has genuinely gone idle reports 0 through the normal path and
 * updates as usual.
 */
export function mergeSample(previous: ProcessSample | null, fresh: ProcessSample | null): ProcessSample | null {
  return fresh ?? previous;
}
