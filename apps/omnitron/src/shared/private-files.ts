/** POSIX owner-only storage for backups, state and logs. Permission failures are fatal to the operation. */
import fs from 'node:fs';
import path from 'node:path';

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;
const SIDECAR_SUFFIXES = ['-shm', '-wal', '-journal'];
// Windows deployments need equivalent OS ACLs; POSIX chmod cannot establish them.
const CAN_CHMOD = process.platform !== 'win32';

function missing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'ENOENT';
}

/** Validate and chmod the same opened inode, without following a substituted leaf link. */
function sealPath(filename: string, directory: boolean, optional = false): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK |
      (directory ? fs.constants.O_DIRECTORY : 0));
  } catch (error) {
    if (optional && missing(error)) return false;
    throw error;
  }
  try {
    const stat = fs.fstatSync(fd);
    if (!(directory ? stat.isDirectory() : stat.isFile()) || stat.uid !== process.getuid?.())
      throw new Error(`Private storage must be ${directory ? 'a directory' : 'a regular file'} owned by the daemon user: ${filename}`);
    // Tightening one hard link changes every alias. Such a file is not isolated storage.
    if (!directory && stat.nlink !== 1) throw new Error(`Private storage cannot have additional hard links: ${filename}`);
    const mode = directory ? PRIVATE_DIR_MODE : PRIVATE_FILE_MODE;
    const changed = (stat.mode & 0o777) !== mode;
    if (changed) fs.fchmodSync(fd, mode);
    if ((fs.fstatSync(fd).mode & 0o777) !== mode) throw new Error(`Private permissions could not be established: ${filename}`);
    return changed;
  } finally { fs.closeSync(fd); }
}

export function ensurePrivateDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: PRIVATE_DIR_MODE });
  if (CAN_CHMOD) sealPath(dir, true);
}

/** A missing SQLite sidecar is normal; a failed seal or missing main file is not. */
export function sealFile(filepath: string): void {
  if (!CAN_CHMOD) return;
  sealPath(filepath, false);
  for (const suffix of SIDECAR_SUFFIXES) sealPath(filepath + suffix, false, true);
}

/** Repair existing regular files. Report failures instead of declaring unsafe files sealed. */
export function sealDirContents(dir: string): number {
  if (!CAN_CHMOD) return 0;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch (error) { if (missing(error)) return 0; throw error; }
  let tightened = 0;
  for (const entry of entries) {
    if (entry.isSymbolicLink()) throw new Error(`Private storage contains a symbolic link: ${path.join(dir, entry.name)}`);
    if (!entry.isFile()) continue;
    if (sealPath(path.join(dir, entry.name), false, true)) tightened++;
  }
  return tightened;
}
