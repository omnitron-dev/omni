import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const execute = promisify(execFile);
export const release = '4f92268d7c16741cfb41e5bbe2aa46cc260a9ea5';
const tag = 'v0.18.5.1', tagObject = 'fe7ebfe689234a885ab2f478b0303ce930810e3b';
const signer = '8777AB8F778EE89487A2F8E7F4ACA0183641E010';
const directory = 'external/db_drivers/liblmdb/';
export const sha = binary => createHash('sha256').update(binary).digest('hex');

/** Compile only the signed release's 64-bit Linux LMDB sources in the building workspace. */
export async function buildHelper(repository, dest, machine) {
  if (!['x86_64', 'aarch64'].includes(machine)) throw Error('Choose x86_64 or aarch64 Linux glibc.');
  const root = path.resolve(repository), output = path.resolve(dest), parent = path.dirname(output);
  const temp = await fs.mkdtemp(path.join(parent, '.lmdb-build-'));
  const git = async args => (await execute('git', ['-C', root, ...args], { encoding: 'buffer', maxBuffer: 4 * 1024 * 1024 })).stdout;
  try {
    const object = (await git(['rev-parse', 'refs/tags/' + tag])).toString().trim();
    const commit = (await git(['rev-parse', 'refs/tags/' + tag + '^{commit}'])).toString().trim();
    if (object !== tagObject || commit !== release) throw Error('Unexpected Monero release or tag object.');
    const gpg = path.join(temp, 'gpg');
    await fs.mkdir(gpg, { mode: 0o700 });
    const key = path.join(temp, 'maintainer.asc');
    await fs.writeFile(key, await git(['cat-file', 'blob', release + ':utils/gpg_keys/luigi1111.asc']));
    const keyring = path.join(gpg, 'release.gpg');
    await execute('gpg', ['--batch', '--homedir', gpg, '--output', keyring, '--dearmor', key]);
    const signed = await git(['cat-file', 'tag', tagObject]);
    const start = signed.indexOf('\n-----BEGIN PGP SIGNATURE-----\n') + 1;
    if (!start) throw Error('The pinned release tag has no OpenPGP signature.');
    const payload = path.join(temp, 'release.tag'), signature = path.join(temp, 'release.sig');
    await fs.writeFile(payload, signed.subarray(0, start));
    await fs.writeFile(signature, signed.subarray(start));
    const verified = await execute('gpgv', ['--homedir', gpg, '--keyring', keyring, '--status-fd', '1', signature, payload]);
    if (!verified.stdout.includes('[GNUPG:] VALIDSIG ' + signer + ' ')) throw Error('The tag signer differs from the reviewed Monero maintainer.');
    for (const file of ['mdb.c', 'midl.c', 'lmdb.h', 'midl.h'])
      await fs.writeFile(path.join(temp, file), await git(['cat-file', 'blob', release + ':' + directory + file]));
    await fs.copyFile(new URL('./snapshot.c', import.meta.url), path.join(temp, 'snapshot.c'));
    const env = { ...process.env, ZIG_GLOBAL_CACHE_DIR: process.env.ZIG_GLOBAL_CACHE_DIR || path.join(parent, '.zig-global'),
      ZIG_LOCAL_CACHE_DIR: process.env.ZIG_LOCAL_CACHE_DIR || path.join(parent, '.zig-local') };
    await execute('zig', ['cc', '-target', machine + '-linux-gnu.2.28', '-Os', '-s', '-D_GNU_SOURCE', '-pthread',
      '-Wl,--build-id=none', '-fno-ident', '-I.', 'snapshot.c', 'mdb.c', 'midl.c', '-o', 'snapshot'],
    { cwd: temp, env, timeout: 300000, maxBuffer: 1024 * 1024 });
    const binary = await fs.readFile(path.join(temp, 'snapshot'));
    await fs.writeFile(output, binary, { flag: 'wx', mode: 0o700 });
    return { release, tag, tagObject, signer, machine, glibcTarget: '2.28', sha256: sha(binary), bytes: binary.length };
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}
