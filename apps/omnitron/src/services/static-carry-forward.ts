/**
 * A chunk the last deployment took away.
 *
 * A page opened before a deployment keeps the build it loaded: its
 * `index.html` and entry name every lazy chunk by its content hash. The
 * deployment then points the gateway at a NEW build directory, and the next
 * lazy route that tab opens asks for a chunk that directory does not have.
 * Measured on daos/test on 2026-09-29, after release d531ab26: the owner's
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
    dryRun ? ':' : 'ls -1 "$FRESH/assets" 2>/dev/null > "$FRESH.own-assets"',
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
 * The build directories gateway containers on the node mount at the web root:
 * running ones (what open tabs loaded) and all of them (what must stay).
 */
export const GATEWAY_MOUNTS_COMMAND = [
  'for c in $(docker ps -aq --filter label=omnitron.service=gateway 2>/dev/null); do',
  '  src=$(docker inspect -f \'{{range .Mounts}}{{if eq .Destination "/var/www/portal"}}{{.Source}}{{end}}{{end}}\' "$c" 2>/dev/null)',
  '  state=$(docker inspect -f \'{{.State.Running}}\' "$c" 2>/dev/null)',
  '  [ -n "$src" ] && echo "$state $src"',
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
