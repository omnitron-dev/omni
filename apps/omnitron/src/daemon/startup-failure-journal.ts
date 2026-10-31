// No framework imports: usable even when a dependency cannot be imported.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export function startupFailureDirectory(): string {
  return path.join(process.env['OMNITRON_HOME'] ?? path.join(os.homedir(), '.omnitron'), 'data', 'startup-failures');
}

export function persistStartupFailure(id: string, bytes: Buffer): void {
  const directory = startupFailureDirectory();
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(directory, `${id}.partial`);
  const fd = fs.openSync(temporary, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  fs.renameSync(temporary, path.join(directory, `${id}.json`));
  const dir = fs.openSync(directory, 'r');
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}
