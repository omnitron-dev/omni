import { pathToFileURL } from 'node:url';

/** Self-contained: run this under the node binary of the actual execution owner. */
export async function targetRuntime() {
  const { createHash } = await import('node:crypto');
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  for await (const part of createReadStream(process.execPath)) hash.update(part);
  const header = process.report?.getReport()?.header;
  return { platform: process.platform, arch: process.arch, node: process.version, abi: process.versions.modules,
    executableSha256: hash.digest('hex'), libc: process.platform === 'linux' ? header?.glibcVersionRuntime ?? 'non-glibc' : null };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  targetRuntime().then(identity => console.log(JSON.stringify(identity))).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
