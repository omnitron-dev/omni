/**
 * A container's configuration files, carried to the node that will run it.
 *
 * A stack's gateway is configured by files — an nginx template, an entrypoint,
 * Lua modules, a maintenance page — and the resolver mounts them from the
 * MASTER's filesystem: `${projectRoot}/infra/nginx/...`. That works while the
 * container runs on the master.
 *
 * On a node it cannot. The node has no copy of the project: measured on the
 * test server, `ls -d /root/daos /opt/daos` finds nothing, and
 * `daos-test-gateway` came up with an empty `Mounts` array, a null entrypoint,
 * zero `UPSTREAM_*` variables and the stock `default.conf` baked into the
 * image. Its onion answered HTTP 200 with `Welcome to OpenResty!` — the
 * gateway's own page, because the gateway had never been told what to proxy.
 *
 * So the files travel with the request that asks for the container. They are
 * small — the daos gateway's six files are 65 KB — and they are text that
 * already crosses the wire as part of a config; carrying them is cheaper than
 * the alternatives (a git checkout on every node, a second image per stack, a
 * shared filesystem) and has no state to drift.
 *
 * The node writes them under its own root and mounts its own copies, so a
 * container's spec on a node names paths that exist on that node. Nothing
 * here reaches back to the master at container start.
 */

import { createHash } from 'node:crypto';

/** One file, as it travels. */
export interface ConfigFile {
  /** Path relative to the config directory — `nginx.conf`, `lua/auth_rate.lua`. */
  path: string;
  content: string;
  /** Octal, as a string. Directories are created 0755 regardless. */
  mode: string;
}

/**
 * The files one service needs, addressed by the service they belong to.
 *
 * Keyed by service name rather than by container name: the node computes its
 * own container names from its own prefix, and a payload keyed on a name the
 * master chose would be a second opinion about naming — the exact defect the
 * `project`/`stack` fields on `provisionStack` exist to prevent.
 */
export type ConfigPayload = Record<string, ConfigFile[]>;

/**
 * Directory names a config payload must never descend into, and file
 * extensions it must never carry.
 *
 * Checked against EVERY segment, not the path as a whole. My first version
 * anchored on `$`, so it caught `.git` and missed `.git/config` — which is the
 * only spelling anyone would actually send, since a bare directory has no
 * content to travel. A denylist that matches the shape nobody writes is a
 * denylist that does nothing.
 */
const REFUSED_SEGMENTS = new Set(['.git', 'node_modules', '.svn', '.hg']);
const REFUSED_FILE = /^(\.env(\..*)?|.*\.(key|pem|p12|pfx|crt|cer))$/i;

/**
 * Whether a relative path is safe to write under a root.
 *
 * A payload arrives over RPC from another daemon, and a path is the one field
 * that can leave the directory it is supposed to stay in. Absolute paths,
 * `..` segments and anything resolving above the root are refused rather than
 * sanitised: a path that needed fixing was not the path the sender meant, and
 * silently rewriting it turns a mistake into a different file.
 */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length > 255) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  const segments = p.split('/');
  if (segments.some((s) => s === '' || s === '.' || s === '..')) return false;
  if (segments.some((s) => s.includes('\0'))) return false;
  if (segments.some((s) => REFUSED_SEGMENTS.has(s.toLowerCase()))) return false;
  return !REFUSED_FILE.test(segments[segments.length - 1] ?? '');
}

/**
 * Octal mode strings this accepts.
 *
 * Exactly four octal digits, and the first — the setuid/setgid/sticky digit —
 * must be `0`. A config file has no business carrying setuid, and a payload
 * that asks for it is either a mistake or an attempt.
 *
 * My first version of this read `!/^0[4267]/`, which tests the second digit —
 * the OWNER permission — so it rejected every ordinary mode (`0644`, `0755`,
 * `0600`) and accepted `0111`. It was wrong in both directions at once, and
 * only running it on real values showed that: the regex looked right, and a
 * predicate that looks right is the kind that ships.
 */
export function isSafeMode(mode: string): boolean {
  return /^0[0-7]{3}$/.test(mode);
}

/**
 * A fingerprint of a service's files.
 *
 * Folded into the container's spec hash by the caller, so a changed template
 * recreates the container. Without it a corrected nginx.conf reaches the node,
 * is written to disk, and the container that has the old one mounted keeps
 * running with it — the same shape as a corrected health check that never
 * reaches anything already running.
 */
export function configFilesHash(files: readonly ConfigFile[]): string {
  const h = createHash('sha256');
  for (const f of [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))) {
    h.update(f.path).update('\0').update(f.mode).update('\0').update(f.content).update('\0');
  }
  return h.digest('hex').slice(0, 16);
}

/** Total bytes of a payload, for the bound the transport needs. */
export function payloadBytes(payload: ConfigPayload): number {
  let total = 0;
  for (const files of Object.values(payload)) {
    for (const f of files) total += Buffer.byteLength(f.content, 'utf-8') + f.path.length;
  }
  return total;
}

/**
 * The most a payload may carry, in bytes.
 *
 * Config files are text and few. A directory that grew a build output, a log
 * or a data file is not a config directory any more, and shipping it through
 * an RPC call would turn one provisioning request into a transfer nobody
 * budgeted for. The daos gateway, the largest real one, is 65 KB.
 */
export const MAX_PAYLOAD_BYTES = 2 * 1024 * 1024;

/**
 * Validate a payload received over RPC.
 *
 * Returns the reasons it is not acceptable — empty means it is. Every check is
 * on the RECEIVING side, because that is the side that has to live with the
 * answer: a sender that has been tampered with, or is simply older, is exactly
 * the case where the sender's own validation is not evidence.
 */
export function validatePayload(payload: unknown): string[] {
  const problems: string[] = [];
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['config payload must be an object keyed by service name'];
  }

  let bytes = 0;
  for (const [service, files] of Object.entries(payload as Record<string, unknown>)) {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/i.test(service)) {
      problems.push(`'${service}' is not a service name`);
      continue;
    }
    if (!Array.isArray(files)) {
      problems.push(`${service}: expected a list of files`);
      continue;
    }
    for (const entry of files) {
      const f = entry as Partial<ConfigFile>;
      if (typeof f?.path !== 'string' || typeof f?.content !== 'string' || typeof f?.mode !== 'string') {
        problems.push(`${service}: a file entry is missing path, content or mode`);
        continue;
      }
      if (!isSafeRelativePath(f.path)) problems.push(`${service}: refusing path '${f.path}'`);
      if (!isSafeMode(f.mode)) problems.push(`${service}: refusing mode '${f.mode}' for '${f.path}'`);
      bytes += Buffer.byteLength(f.content, 'utf-8');
    }
  }

  if (bytes > MAX_PAYLOAD_BYTES) {
    problems.push(`config payload is ${Math.round(bytes / 1024)} KB, over the ${MAX_PAYLOAD_BYTES / 1024} KB limit`);
  }
  return problems;
}

/**
 * Where a node keeps the config files a master sent it.
 *
 * Under the daemon's own home, partitioned by project and stack, because two
 * stacks on one node have two gateways with two different templates and the
 * only thing distinguishing them is which stack asked. Same reasoning as the
 * container prefix: without it the second stack overwrites the first's
 * configuration and reconciles a container towards a spec nobody declared.
 */
export function nodeConfigRoot(home: string, project: string, stack: string, service: string): string {
  const safe = (s: string) => (/^[a-z0-9][a-z0-9-]{0,63}$/i.test(s) ? s : 'unknown');
  return `${home}/.omnitron/stack-config/${safe(project)}/${safe(stack)}/${safe(service)}`;
}

/**
 * Write one service's files under a root, and report where they landed.
 *
 * Validated first, entirely, before anything is written: a payload with one
 * bad path must not leave half a configuration on disk, because a gateway
 * that starts with four of its six files is worse than one that does not
 * start — it serves something, and what it serves is nobody's intention.
 *
 * Files this wrote before and are no longer in the payload are removed, so a
 * Lua module deleted upstream stops being mounted here. A stale file in a
 * config directory is read by the thing that globs the directory, which is how
 * a removed rule keeps applying.
 */
export async function writeConfigFiles(
  root: string,
  files: readonly ConfigFile[],
  host: { writeFile(path: string, content: string, options: { mode: string }): Promise<void> },
  remove: (path: string) => Promise<void>,
  list: (dir: string) => Promise<string[]>,
): Promise<{ root: string; written: string[] }> {
  const problems = validatePayload({ service: files as never });
  if (problems.length > 0) throw new Error(problems.join('; '));

  const written: string[] = [];
  for (const f of files) {
    await host.writeFile(`${root}/${f.path}`, f.content, { mode: f.mode });
    written.push(f.path);
  }

  const keep = new Set(written);
  for (const existing of await list(root)) {
    if (!keep.has(existing)) await remove(`${root}/${existing}`);
  }

  return { root, written };
}

/**
 * Read a service's config directory into a payload, on the master.
 *
 * Walks the directory the resolver would have mounted. Refused paths are
 * skipped with a reason rather than aborting: a project that happens to have
 * a `.git` inside its nginx directory should still get a working gateway, and
 * the operator should be told what was left behind.
 */
export async function readConfigDirectory(
  dir: string,
  fs: {
    readdir(d: string): Promise<Array<{ name: string; isDirectory(): boolean }>>;
    readFile(p: string): Promise<string>;
    stat(p: string): Promise<{ mode: number }>;
  },
): Promise<{ files: ConfigFile[]; skipped: string[] }> {
  const files: ConfigFile[] = [];
  const skipped: string[] = [];

  async function walk(prefix: string): Promise<void> {
    const entries = await fs.readdir(prefix ? `${dir}/${prefix}` : dir);
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (!isSafeRelativePath(rel)) { skipped.push(rel); continue; }
        await walk(rel);
        continue;
      }
      if (!isSafeRelativePath(rel)) { skipped.push(rel); continue; }
      const full = `${dir}/${rel}`;
      // The mode comes off the file: an entrypoint is executable because
      // someone made it so, and a payload that flattened everything to 0644
      // would ship a script the container cannot run.
      const { mode } = await fs.stat(full);
      files.push({ path: rel, content: await fs.readFile(full), mode: `0${(mode & 0o777).toString(8).padStart(3, '0')}` });
    }
  }

  await walk('');
  return { files, skipped };
}
