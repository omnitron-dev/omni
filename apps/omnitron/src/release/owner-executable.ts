import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { sha256File } from './portable-archive.js';

const run = promisify(execFile);

/** Compare the actual resident owner's executable, not the controller's version string or its service definition. */
export async function assertOwnerExecutable(pid: number, expectedSha256: string): Promise<void> {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw Error('Invalid local execution owner PID');
  let file: string;
  if (process.platform === 'linux') file = '/proc/' + pid + '/exe';
  else if (process.platform === 'darwin') {
    const options = { encoding: 'utf8' as const, timeout: 5000, maxBuffer: 2 * 1024 * 1024 };
    const [{ stdout: name }, { stdout: mappings }] = await Promise.all([
      run('/bin/ps', ['-p', String(pid), '-o', 'comm='], options),
      run('/usr/sbin/lsof', ['-nP', '-a', '-p', String(pid), '-d', 'txt', '-FDin'], options),
    ]);
    file = name.trim();
    if (!path.isAbsolute(file) || /[\r\n]/.test(file) || await fs.realpath(file) !== file) throw Error('Cannot identify the execution owner image');
    const image = await fs.stat(file, { bigint: true });
    const mapped = mappings.split('\nftxt\n').slice(1).some(record => {
      const fields = record.trimEnd().split('\n');
      return fields.includes('n' + file) && fields.includes('i' + image.ino) &&
        fields.some(f => /^D0x[0-9a-f]+$/i.test(f) && BigInt(f.slice(1)) === image.dev);
    });
    if (!mapped) throw Error('The registered owner image is no longer mapped at its original inode');
  } else throw Error('Local release verification does not support process images on ' + process.platform);
  const before = await fs.stat(file, { bigint: true });
  const actual = await sha256File(file);
  const after = await fs.stat(file, { bigint: true });
  if (actual !== expectedSha256 || before.dev !== after.dev || before.ino !== after.ino || before.ctimeNs !== after.ctimeNs)
    throw Error('Execution owner is not running the Node executable selected for this local release');
}
