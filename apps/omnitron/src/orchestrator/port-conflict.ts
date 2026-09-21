/**
 * Who is holding the port an application could not bind.
 *
 * Measured on the development daemon, 06:05:56–06:06:27Z, four times in
 * thirty-one seconds:
 *
 *     Restart failed — Netron service failed to start: listen EADDRINUSE:
 *     address already in use 0.0.0.0:3005. The application cannot serve RPC,
 *     so it is not started.
 *
 * `omnitron list` then reported the app `crashed, RST 5` with both children
 * `stopped` and no pid, and `omnitron restart` answered `Max restarts
 * exceeded`. All of that was true of the daemon's records and none of it was
 * true of the machine: port 3005 was held by a LIVE process whose parent was
 * the daemon itself — a child of its own it had stopped accounting for. The
 * application was serving requests the whole time.
 *
 * The failure says which address it could not have. It does not say who has
 * it, and that one fact is the difference between a three-minute
 * investigation with `lsof` and a line in the log. Three readings compose
 * it: the address out of the message, the holder out of the operating
 * system, and the parent of the holder — because "somebody else's server" and
 * "my own previous instance" call for opposite responses, and they look
 * identical from inside the error.
 *
 * This module only reads and decides. Killing belongs to the janitor, which
 * already reaps children the daemon has lost track of — and a holder that is
 * our own unaccounted child is exactly what that sweep exists for.
 */

export interface AddressInUse {
  /** As the error spells it: `0.0.0.0`, `127.0.0.1`, `::`. */
  readonly host: string;
  readonly port: number;
}

/**
 * The address an `EADDRINUSE` refers to, or null when the message is about
 * something else.
 *
 * Node writes `listen EADDRINUSE: address already in use 0.0.0.0:3005`, and
 * every layer above wraps it in a sentence of its own, so the match is on
 * the address rather than on the shape of the whole message.
 */
export function addressInUse(message: string): AddressInUse | null {
  if (!message.includes('EADDRINUSE')) return null;
  // `host:port`, where the host may be IPv4, `::`, a bracketed IPv6 or a
  // path-free empty string in some Node versions.
  const match = /EADDRINUSE[^0-9[]*(\[[0-9a-fA-F:]+\]|[0-9.]+|::)?:(\d{1,5})\b/.exec(message);
  if (!match) return null;
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  return { host: match[1] ?? '', port };
}

export interface PortHolder {
  readonly pid: number;
  /** The command name, for a log line a person reads once. */
  readonly command: string;
}

/** What to run to find the listener, per platform. */
export function holderCommand(port: number, platform: NodeJS.Platform): { file: string; args: string[] } {
  if (platform === 'linux') {
    // `-H` drops the header; `-p` adds `users:(("node",pid=989927,fd=28))`.
    return { file: 'ss', args: ['-ltnpH', `sport = :${port}`] };
  }
  // `-F` is lsof's machine-readable mode: one field per line, tagged.
  return { file: 'lsof', args: ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fpc'] };
}

/**
 * The listeners in that command's output.
 *
 * Both formats are parsed here rather than in the caller so that the shapes
 * are pinned by tests against real output — `lsof -F` emits `p<pid>` and
 * `c<command>` on separate lines and repeats them per process, and `ss`
 * carries every listener's holders inside one `users:((...))` group.
 */
export function parseHolders(output: string, platform: NodeJS.Platform): PortHolder[] {
  const holders: PortHolder[] = [];

  if (platform === 'linux') {
    for (const m of output.matchAll(/\(\("([^"]+)",pid=(\d+),/g)) {
      holders.push({ command: m[1]!, pid: Number(m[2]) });
    }
    return holders;
  }

  let pid: number | null = null;
  for (const line of output.split('\n')) {
    if (line.startsWith('p')) {
      const parsed = Number(line.slice(1));
      pid = Number.isInteger(parsed) ? parsed : null;
      continue;
    }
    if (line.startsWith('c') && pid !== null) {
      holders.push({ pid, command: line.slice(1) });
      pid = null;
    }
  }
  return holders;
}

export type ConflictVerdict =
  /** Our own child that nothing in the daemon claims — the janitor's case. */
  | { readonly kind: 'ours-unaccounted'; readonly holder: PortHolder; readonly because: string }
  /** Our own child, and the daemon still says it owns it. */
  | { readonly kind: 'ours-owned'; readonly holder: PortHolder; readonly because: string }
  /** Somebody else's process. Nothing here may touch it. */
  | { readonly kind: 'foreign'; readonly holder: PortHolder; readonly because: string }
  /** Nobody answered, which is its own finding. */
  | { readonly kind: 'unknown'; readonly because: string };

/**
 * What the holder is to this daemon.
 *
 * `ours-unaccounted` is the case the measurement above describes and the only
 * one where a restart can be made to work without a person: the process is a
 * child of this daemon and no app handle, pool or process-manager record
 * claims it, so it is a leftover of a restart that half-failed.
 */
export function explainConflict(input: {
  readonly port: number;
  readonly holders: readonly PortHolder[];
  readonly parentOf: (pid: number) => number | undefined;
  readonly daemonPid: number;
  readonly owned: ReadonlySet<number>;
}): ConflictVerdict {
  const { port, holders, parentOf, daemonPid, owned } = input;
  if (holders.length === 0) {
    return {
      kind: 'unknown',
      because: `nothing is listening on ${port} now — the holder exited between the failure and this reading`,
    };
  }

  const holder = holders[0]!;
  const parent = parentOf(holder.pid);

  if (parent !== daemonPid) {
    return {
      kind: 'foreign',
      holder,
      because:
        `port ${port} is held by pid ${holder.pid} (${holder.command}), whose parent is ` +
        `${parent ?? 'unknown'} — not this daemon. Nothing here will touch it`,
    };
  }
  if (owned.has(holder.pid)) {
    return {
      kind: 'ours-owned',
      holder,
      because:
        `port ${port} is held by pid ${holder.pid} (${holder.command}), a child this daemon ` +
        `still accounts for — the restart raced its own predecessor's shutdown`,
    };
  }
  return {
    kind: 'ours-unaccounted',
    holder,
    because:
      `port ${port} is held by pid ${holder.pid} (${holder.command}), a child of this daemon ` +
      `that no app, pool or process-manager record claims — a leftover of a restart that half-failed`,
  };
}
