/**
 * A chunk the last deployment took away.
 *
 * A page opened before a deployment keeps the build it loaded: its
 * `index.html` and entry name every lazy chunk by its content hash. The
 * deployment then points the gateway at a NEW build directory, and the next
 * lazy route that tab opens asks for a chunk that directory does not have.
 * Measured on sample/test on 2026-09-29, after release d531ab26: the owner's
 * /admin/config answered «error loading dynamically imported module:
 * …/assets/config-CUEyrA2c.js», which was 404 — while the current build was
 * whole (243 files referenced by its index and entry, all 200) and the chunk
 * sat, intact, in the previous build's directory on the same disk
 * (`/opt/omnitron/stack-static/gateway/0d98bee79c410715/assets/`). Testers
 * met it «everywhere»: every tab older than the deployment, on every route it
 * had not opened yet. The gateway logs none of it — `/assets/` has
 * `access_log off`.
 *
 * So a new build carries the assets of the build the gateway is serving now,
 * hard-linked into its `assets/` (content-hashed names never collide, and a
 * link costs no space): a tab from before the deployment keeps working until
 * its reader reloads. One generation, from each build's OWN list
 * (`<dir>.own-assets`, written here beside the directory, never served) —
 * carrying what was carried would grow every build by every build before it.
 *
 * And the builds nobody serves are removed: 122 directories, 3.9 GB, had
 * accumulated on the test node since 2026-09-10. Kept: the newest `keep`,
 * the new one, and every directory ANY gateway container names — running or
 * stopped, because a stopped stack's gateway comes back with the mount it
 * has.
 */

import { shellEscape } from '../shared/shell-escape.js';

/** Directory names are the first 16 hex of the archive's sha256 (`uploadStaticBundle`). */
const BUILD_DIR = '[0-9a-f]{16}';

/**
 * The script run on the node once a build is unpacked into `fresh`, before
 * its `.delivered` marker is written. `serving` are the build directories the
 * RUNNING gateways mount now (what open tabs loaded); `mounted` are those ANY
 * gateway container mounts (never removed). Prints one line:
 * `carried <n> from <k> build(s); pruned <m> build(s)`.
 */
export function carryForwardScript(options: {
  root: string;
  fresh: string;
  serving: readonly string[];
  mounted: readonly string[];
  keep: number;
  /** Count and name what would be carried and removed; link and remove nothing. */
  dryRun?: boolean;
}): string {
  const { root, fresh, serving, mounted, keep, dryRun = false } = options;
  const q = shellEscape;
  const servingList = serving.map(q).join(' ');
  const keepList = [fresh, ...mounted].map(q).join(' ');
  return [
    'set -u',
    `ROOT=${q(root)}; FRESH=${q(fresh)}; KEEP=${Math.max(1, Math.floor(keep))}`,
    // The new build's own assets, beside it (a directory's contents are served).
    //
    // Written ONCE, and never again for the same directory. A rollback runs
    // this for a build that is already on the node and has already been
    // carried into — its `assets/` now holds another build's chunks as hard
    // links. Rewriting the list there would record those as its own, and the
    // next deployment carrying from it would carry a second generation, which
    // is the growth this file exists to stop.
    dryRun ? ':' : '[ -s "$FRESH.own-assets" ] || ls -1 "$FRESH/assets" 2>/dev/null > "$FRESH.own-assets"',
    'carried=0; from=0',
    `for S in ${servingList}; do`,
    '  case "$S" in "$ROOT"/*) ;; *) continue ;; esac',
    '  [ "$S" = "$FRESH" ] && continue',
    '  [ -d "$S/assets" ] || continue',
    '  from=$((from + 1))',
    '  if [ -s "$S.own-assets" ]; then LIST="$S.own-assets"; else LIST=$(mktemp); ls -1 "$S/assets" > "$LIST"; fi',
    '  while IFS= read -r f; do',
    '    case "$f" in ""|*/*|.*) continue ;; esac',
    '    [ -e "$FRESH/assets/$f" ] && continue',
    '    [ -f "$S/assets/$f" ] || continue',
    dryRun
      ? '    :'
      : '    ln "$S/assets/$f" "$FRESH/assets/$f" 2>/dev/null || cp -p "$S/assets/$f" "$FRESH/assets/$f" || continue',
    '    carried=$((carried + 1))',
    '  done < "$LIST"',
    'done',
    // Prune: the build directories, newest first; keep the newest KEEP and every named one.
    'pruned=0; n=0',
    `for D in $(ls -1dt "$ROOT"/* 2>/dev/null | grep -E "/${BUILD_DIR}$"); do`,
    '  [ -d "$D" ] || continue',
    '  n=$((n + 1))',
    '  [ "$n" -le "$KEEP" ] && continue',
    '  held=0',
    `  for K in ${keepList}; do [ "$D" = "$K" ] && held=1; done`,
    '  [ "$held" = 1 ] && continue',
    dryRun
      ? '  echo "would remove $D"; pruned=$((pruned + 1))'
      : '  rm -rf "$D" "$D.delivered" "$D.own-assets" "$D.tar.gz" && pruned=$((pruned + 1))',
    'done',
    `echo "${dryRun ? 'would carry' : 'carried'} $carried from $from build(s); ${dryRun ? 'would prune' : 'pruned'} $pruned build(s)"`,
  ].join('\n');
}

/**
 * What a stack's `current` link is called, inside the static root.
 *
 * `current-<project>-<stack>`, because `/opt/omnitron/stack-static/gateway` is
 * shared by every stack on the NODE — the literal is passed to
 * `uploadStaticBundle` with no project and no stack in it — and several stacks
 * do run on one node. A bare `current` would make one deployment repoint
 * another stack's portal.
 *
 * Both sides spell it from here: the master when it swaps the link, and the
 * shell below when it reads a container's back. `CONTAINER_PREFIX` is the same
 * `<project>-<stack>`, which is why the container is `<project>-<stack>-gateway`.
 */
export function gatewayStaticLinkName(project: string, stack: string): string {
  return `current-${project}-${stack}`;
}

/**
 * The build directories gateway containers on the node serve: running ones
 * (what open tabs loaded) and all of them (what must stay).
 *
 * It used to read the mount SOURCE, which was the build directory itself. Once
 * the gateway mounts the static ROOT and serves through `current-<stack>`, the
 * source is the same constant for every gateway on the node — so the source
 * answers «which build» with nothing, and both halves of the script below fail
 * silently: the carry-forward finds no `assets/` under a root and copies
 * nothing (printing `carried 0 from 0 build(s)`, a line that looks fine), and
 * the prune stops holding any build, leaving only «newest 5 by mtime» — which
 * is exactly the wrong rule on a ROLLBACK, where the wanted build is old.
 *
 * So it resolves the link instead. `readlink -f`, not `readlink`: the link is
 * relative (it must be — it is resolved inside the container), and the reader
 * below wants an absolute path. A gateway with no link yet — the first
 * deployment — prints nothing, and there is nothing to carry.
 */
export const GATEWAY_MOUNTS_COMMAND = [
  'for c in $(docker ps -aq --filter label=omnitron.service=gateway 2>/dev/null); do',
  '  src=$(docker inspect -f \'{{range .Mounts}}{{if eq .Destination "/var/www/portal"}}{{.Source}}{{end}}{{end}}\' "$c" 2>/dev/null)',
  '  state=$(docker inspect -f \'{{.State.Running}}\' "$c" 2>/dev/null)',
  '  [ -n "$src" ] || continue',
  // The mount is either the build directory (before this change, and on a
  // master serving a project-relative `staticDir`) or the root that holds
  // `current-<project>-<stack>`. Ask the labels which stack, resolve the
  // link, and fall back to the source itself when there is no link.
  '  proj=$(docker inspect -f \'{{index .Config.Labels "omnitron.project"}}\' "$c" 2>/dev/null)',
  '  stk=$(docker inspect -f \'{{index .Config.Labels "omnitron.stack"}}\' "$c" 2>/dev/null)',
  '  tgt=""',
  // The link's name comes from `gatewayStaticLinkName` even here: given the
  // shell's own variables it yields the shell's own string, so there is one
  // spelling and not two that drift.
  `  [ -n "$proj" ] && [ -n "$stk" ] && tgt=$(readlink -f "$src/${gatewayStaticLinkName('$proj', '$stk')}" 2>/dev/null)`,
  '  [ -n "$tgt" ] || tgt="$src"',
  '  echo "$state $tgt"',
  'done',
].join('\n');

/** `true /opt/…/abc` lines → the running and the mounted sources. */
export function readGatewayMounts(output: string): { serving: string[]; mounted: string[] } {
  const serving: string[] = [];
  const mounted: string[] = [];
  for (const line of output.split('\n')) {
    const m = /^(true|false)\s+(\/\S+)$/.exec(line.trim());
    if (!m) continue;
    mounted.push(m[2]!);
    if (m[1] === 'true') serving.push(m[2]!);
  }
  return { serving: [...new Set(serving)], mounted: [...new Set(mounted)] };
}

/** Stable public URLs retain their bytes independently of release-directory retention. */
export type StaticAssetOwner = { project: string; stack: string; app: string };
export type StaticAssetSource = { root: string; files: Record<string, string> };
export type StaticAssetPublication = {
  owner: StaticAssetOwner;
  sources: StaticAssetSource[];
};
export type StaticAssetReceipt = {
  assetsRoot: string;
  manifestSha256: string;
  files: number;
  added: number;
  reused: number;
  bytes: number;
};
const ASSET_STORAGE = '/opt/omnitron/stack-static/assets';
export function immutableAssetsRoot(owner: StaticAssetOwner): string {
  if (
    !owner ||
    Object.keys(owner).sort().join(',') !== 'app,project,stack' ||
    ![owner.project, owner.stack, owner.app].every(
      (part) => typeof part === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(part),
    )
  )
    throw new Error('Invalid static asset owner');
  return `${ASSET_STORAGE}/${owner.project}/${owner.stack}/${owner.app}/public`;
}

/** Self-contained destination program. Every writer MUST hold the native exclusive execution fence. */
function immutableAssetProgram(input: StaticAssetPublication, storage: string, replaying = false): StaticAssetReceipt {
  const fs = require('node:fs') as typeof import('node:fs');
  const path = require('node:path') as typeof import('node:path');
  const crypto = require('node:crypto') as typeof import('node:crypto');
  type Entry = { sha256: string; bytes: number };
  type Manifest = {
    schema: 1;
    owner: StaticAssetOwner;
    files: Record<string, Entry>;
  };
  const fail = (reason: string): never => {
    throw new Error('Immutable assets: ' + reason);
  };
  const object = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);
  const digest = (bytes: Buffer | string) => crypto.createHash('sha256').update(bytes).digest('hex');
  const safeName = (name: string) =>
    name.length > 0 &&
    name.length <= 1024 &&
    name.split('/').every((part) => /^[a-zA-Z0-9_@+-][a-zA-Z0-9._@+-]*$/.test(part));
  if (
    !object(input) ||
    !object(input.owner) ||
    Object.keys(input.owner).sort().join(',') !== 'app,project,stack' ||
    ![input.owner.project, input.owner.stack, input.owner.app].every(
      (part) => typeof part === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(part),
    ) ||
    !Array.isArray(input.sources) ||
    input.sources.length === 0
  )
    fail('invalid owner or sources');
  const owner = {
    project: input.owner.project,
    stack: input.owner.stack,
    app: input.owner.app,
  };
  if (!path.isAbsolute(storage) || path.resolve(storage) !== storage) fail('noncanonical storage');
  const ownerRoot = path.join(storage, owner.project, owner.stack, owner.app),
    publicRoot = path.join(ownerRoot, 'public');
  const manifestFile = path.join(ownerRoot, 'manifest.json'),
    pendingFile = path.join(ownerRoot, 'pending.json');
  const syncDir = (name: string) => {
    const fd = fs.openSync(name, 'r');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const directory = (name: string, create = false) => {
    if (!path.isAbsolute(name) || path.resolve(name) !== name) fail('noncanonical directory: ' + name);
    let current = path.parse(name).root;
    for (const component of name.slice(current.length).split('/').filter(Boolean)) {
      const parent = current;
      current = path.join(current, component);
      let st: import('node:fs').Stats;
      try {
        st = fs.lstatSync(current);
      } catch (error) {
        if (!create || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        fs.mkdirSync(current, { mode: 0o755 });
        fs.chmodSync(current, 0o755); // native remote commands inherit umask 077
        syncDir(parent);
        st = fs.lstatSync(current);
      }
      if (!st.isDirectory() || st.isSymbolicLink()) fail('directory symlink or non-directory: ' + current);
    }
    if (fs.realpathSync(name) !== name) fail('directory alias: ' + name);
  };
  const read = (file: string): Buffer => {
    directory(path.dirname(file));
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      if (!fs.fstatSync(fd).isFile()) fail('nonregular file: ' + file);
      return fs.readFileSync(fd);
    } finally {
      fs.closeSync(fd);
    }
  };
  const inventory = (root: string): string[] => {
    directory(root);
    const names: string[] = [];
    const walk = (dir: string, prefix: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = prefix + entry.name;
        if (!safeName(name) || entry.isSymbolicLink()) fail('unsafe asset: ' + name);
        if (entry.isDirectory()) walk(path.join(dir, entry.name), name + '/');
        else if (entry.isFile()) names.push(name);
        else fail('nonregular asset: ' + name);
      }
    };
    walk(root, '');
    return names.sort();
  };
  const validateManifest = (value: unknown): Manifest => {
    if (
      !object(value) ||
      value['schema'] !== 1 ||
      JSON.stringify(value['owner']) !== JSON.stringify(owner) ||
      !object(value['files'])
    )
      fail('invalid pool manifest');
    const parsed = value as unknown as Manifest;
    for (const [name, entry] of Object.entries(parsed.files)) {
      if (
        !safeName(name) ||
        !object(entry) ||
        !/^[a-f0-9]{64}$/.test(entry.sha256) ||
        !Number.isSafeInteger(entry.bytes) ||
        entry.bytes < 0
      )
        fail('invalid pool entry: ' + name);
    }
    return parsed;
  };
  const exists = (file: string) => {
    try {
      fs.lstatSync(file);
      return true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
      throw e;
    }
  };
  const load = (file: string) => validateManifest(JSON.parse(read(file).toString('utf8')));
  const encode = (manifest: Manifest) =>
    JSON.stringify({
      schema: 1,
      owner,
      files: Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))),
    }) + '\n';
  const writeAtomic = (file: string, bytes: string) => {
    const temp = file + '.' + crypto.randomUUID() + '.tmp',
      fd = fs.openSync(temp, 'wx', 0o600);
    try {
      fs.writeFileSync(fd, bytes);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(temp, file);
    syncDir(path.dirname(file));
  };
  directory(ownerRoot, true);
  directory(publicRoot, true);
  const baseline: Manifest = exists(manifestFile) ? load(manifestFile) : { schema: 1, owner, files: {} };
  const pending = exists(pendingFile) ? (load(pendingFile) as Manifest & { sources?: StaticAssetSource[] }) : null;
  if (pending)
    for (const [name, entry] of Object.entries(baseline.files)) {
      if (JSON.stringify(pending.files[name]) !== JSON.stringify(entry))
        fail('pending publication changes retained asset: ' + name);
    }
  const admitted = pending ?? baseline,
    present = new Set(inventory(publicRoot));
  for (const name of present) {
    const entry = Object.hasOwn(admitted.files, name) ? admitted.files[name] : undefined;
    if (!entry) fail('unrecorded public asset: ' + name);
    const bytes = read(path.join(publicRoot, name));
    if (bytes.length !== entry!.bytes || digest(bytes) !== entry!.sha256) fail('retained asset integrity: ' + name);
  }
  for (const name of Object.keys(baseline.files)) if (!present.has(name)) fail('missing retained asset: ' + name);
  if (pending && !replaying) {
    const incomplete = Object.keys(pending.files).some((name) => !present.has(name));
    if (incomplete) {
      if (!Array.isArray(pending.sources) || pending.sources.length === 0)
        fail('pending publication has no recoverable source descriptors');
      // Complete the original validated intention first, even if this caller is a later release.
      immutableAssetProgram({ owner, sources: pending.sources! }, storage, true);
    } else {
      // All planned bytes already passed integrity verification; no source directory is needed.
      writeAtomic(manifestFile, encode(pending));
      fs.unlinkSync(pendingFile);
      syncDir(ownerRoot);
    }
    return immutableAssetProgram(input, storage);
  }
  const stage = fs.mkdtempSync(path.join(ownerRoot, '.staging-'));
  fs.chmodSync(stage, 0o700);
  const requested: Record<string, Entry> = Object.create(null);
  try {
    // Copy and validate every requested byte before changing any public URL.
    for (const source of input.sources) {
      if (
        !object(source) ||
        typeof source.root !== 'string' ||
        !object(source.files) ||
        Object.keys(source.files).length === 0
      )
        fail('invalid or empty source');
      directory(source.root);
      const names = Object.keys(source.files).sort();
      if (JSON.stringify(names) !== JSON.stringify(inventory(source.root)))
        fail('source inventory differs from manifest: ' + source.root);
      for (const name of names) {
        const expected = source.files[name];
        if (!safeName(name) || typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))
          fail('invalid source identity: ' + name);
        const bytes = read(path.join(source.root, name));
        if (digest(bytes) !== expected) fail('source digest differs: ' + name);
        const entry = { sha256: expected!, bytes: bytes.length };
        for (const prior of [Object.hasOwn(admitted.files, name) ? admitted.files[name] : undefined, requested[name]])
          if (prior && (prior.sha256 !== entry.sha256 || prior.bytes !== entry.bytes)) fail('URL collision: ' + name);
        if (!requested[name] && !present.has(name)) {
          const file = path.join(stage, name);
          directory(path.dirname(file), true);
          const fd = fs.openSync(file, 'wx', 0o444);
          try {
            fs.writeFileSync(fd, bytes);
            fs.fchmodSync(fd, 0o444); // readable through an app-owned nginx bind mount
            fs.fsyncSync(fd);
          } finally {
            fs.closeSync(fd);
          }
        }
        requested[name] = entry;
      }
    }
    for (const name of Object.keys(admitted.files))
      if (!present.has(name) && !requested[name]) fail('unfinished publication requires its original sources: ' + name);
    const next: Manifest = {
        schema: 1,
        owner,
        files: { ...admitted.files, ...requested },
      },
      encoded = encode(next);
    // A durable intention identifies partial publication after a lost controller/acknowledgement.
    writeAtomic(pendingFile, JSON.stringify({ ...next, sources: input.sources }) + '\n');
    let added = 0;
    for (const name of Object.keys(requested).sort()) {
      if (present.has(name)) continue;
      const destination = path.join(publicRoot, name),
        staged = path.join(stage, name);
      directory(path.dirname(destination), true);
      if (exists(destination)) fail('destination appeared before publication: ' + name);
      const copied = read(staged);
      if (digest(copied) !== requested[name]!.sha256 || copied.length !== requested[name]!.bytes)
        fail('staged asset integrity: ' + name);
      // All writers use the same native exclusive execution fence. No source inode is linked.
      fs.renameSync(staged, destination);
      syncDir(path.dirname(destination));
      added++;
    }
    writeAtomic(manifestFile, encoded);
    fs.unlinkSync(pendingFile);
    syncDir(ownerRoot);
    return {
      assetsRoot: publicRoot,
      manifestSha256: digest(encoded),
      files: Object.keys(next.files).length,
      added,
      reused: Object.keys(requested).length - added,
      bytes: Object.values(next.files).reduce((sum, entry) => sum + entry.bytes, 0),
    };
  } finally {
    fs.rmSync(stage, { recursive: true, force: true });
  }
}

/** Runs only inside the caller's native node execution fence; custom storage isolates integration tests. */
export function immutableAssetsScript(inputFile: string, storage = ASSET_STORAGE): string {
  const source = `const fs=require('node:fs');const input=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));const receipt=(${immutableAssetProgram.toString()})(input,process.argv[2]);process.stdout.write(JSON.stringify(receipt)+'\\n');`;
  return `node -e ${shellEscape(source)} ${shellEscape(inputFile)} ${shellEscape(storage)}`;
}
