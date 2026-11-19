import fs from 'node:fs';

export const serviceReadFlags = fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
export function readOwnedServiceBytes(file: string, uid: number, limit: number, privateFile = false): Buffer {
  const fd = fs.openSync(file, serviceReadFlags);
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.uid !== BigInt(uid) || before.nlink !== 1n || before.size > BigInt(limit) ||
        (before.mode & (privateFile ? 0o077n : 0o022n)) !== 0n) throw Error('Unexpected owner, type, size or mode of a reviewed file');
    const data = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < data.length) {
      const count = fs.readSync(fd, data, offset, data.length - offset, null);
      if (!count) break;
      offset += count;
    }
    const after = fs.fstatSync(fd, { bigint: true });
    if (BigInt(offset) !== before.size || before.ctimeNs !== after.ctimeNs || before.ino !== after.ino)
      throw Error('A reviewed file changed while being read');
    return data.subarray(0, offset);
  } finally { fs.closeSync(fd); }
}
