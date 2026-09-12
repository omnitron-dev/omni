/**
 * Files only the daemon's own user may read.
 *
 * Measured on a working host, 2026-09-12: `~/.omnitron/backups` was 0755 and
 * every one of its 493 files was 0644 — world-readable. Among them 40
 * `tor-keys` archives (the hidden service's ed25519 secret key: whoever holds
 * one can BE the .onion), 48 `main` dumps (every user row, password hash,
 * TOTP secret and PGP key), 48 `payments` dumps, and the live
 * `~/.omnitron/data/daemon-state.db`. Anyone with a shell account on that
 * machine could read all of it.
 *
 * The rule was already in the codebase a directory away: `config.json` is
 * written 0600 and `daemon.sock` is bound 0600. What was missing was applying
 * it to the files that matter most, and the reason is ordinary — those two are
 * written by `fs.writeFileSync`, which takes a mode, while a backup is
 * produced by `pg_dump > file`, `tar czf` or `sqlite3 .backup`, where the mode
 * comes from the process umask and nobody chose it.
 *
 * So the mode is applied AFTER creation, at the one place each kind of file is
 * finished, rather than hoped for from a umask the daemon does not control.
 *
 * Not encryption. A backup on this disk is still plaintext, and that is a
 * separate decision with a key-management question attached. This only stops
 * the other accounts on the host from reading it.
 */
import fs from 'node:fs';
import path from 'node:path';

/** `rwx------` — the owner, and nobody else. */
export const PRIVATE_DIR_MODE = 0o700;

/** `rw-------`. */
export const PRIVATE_FILE_MODE = 0o600;

/** SQLite leaves these beside the database it opens; they hold the same data. */
const SIDECAR_SUFFIXES = ['-shm', '-wal', '-journal'];

/** POSIX modes mean nothing on Windows, and `chmod` there is a partial lie. */
const CAN_CHMOD = process.platform !== 'win32';

/**
 * Create `dir` if missing, and make sure it is 0700 either way.
 *
 * `mkdirSync(dir, { mode })` applies the mode only to directories it actually
 * creates, so on every host where the directory already exists — which is
 * every host that has run the daemon before — passing a mode alone changes
 * nothing. That is why the chmod is unconditional.
 */
export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (!CAN_CHMOD) return;
  try {
    fs.chmodSync(dir, PRIVATE_DIR_MODE);
  } catch {
    /* not ours to chmod — the caller still gets a usable directory */
  }
}

/**
 * Make one file owner-only, along with any SQLite sidecar beside it.
 *
 * Best-effort: a backup that exists and is readable by its owner beats one
 * that threw on the way to being tightened.
 */
export function sealFile(filepath: string): void {
  if (!CAN_CHMOD) return;
  for (const suffix of ['', ...SIDECAR_SUFFIXES]) {
    try {
      fs.chmodSync(filepath + suffix, PRIVATE_FILE_MODE);
    } catch {
      /* missing sidecar, or not ours */
    }
  }
}

/**
 * Tighten everything already in `dir`, and report how much was loose.
 *
 * The fix has to reach backwards: files written before it landed are the ones
 * that have been sitting there longest. Returns the number of entries whose
 * mode this actually changed, so a boot can say so once and then stay quiet.
 */
export function sealDirContents(dir: string): number {
  if (!CAN_CHMOD) return 0;
  let tightened = 0;
  let entries: string[];
  try {
    entries = fs.readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry);
    try {
      const stat = fs.lstatSync(full);
      if (!stat.isFile()) continue;
      // Only the group/other bits matter here; leave the owner's alone.
      if ((stat.mode & 0o077) === 0) continue;
      fs.chmodSync(full, PRIVATE_FILE_MODE);
      tightened++;
    } catch {
      /* raced with a delete, or not ours */
    }
  }
  return tightened;
}
