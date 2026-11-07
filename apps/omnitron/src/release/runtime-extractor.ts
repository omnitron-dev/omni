/** Embedded in both receiver commands, including commands sent to older runtimes.
 * Keep the function self-contained: the receiver can only load its own sealed packages. */
export async function loadRuntimeExtractor(controlPackage: string): Promise<typeof import('tar')> {
  const fs = await import('node:fs/promises');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const runtime = path.resolve(controlPackage, '../..');
  const direct = await fs.realpath(path.join(controlPackage, 'node_modules', 'tar'));
  const request = createRequire(path.join(controlPackage, 'package.json'));
  const entry = await fs.realpath(request.resolve('tar'));
  if (!direct.startsWith(runtime + path.sep) || !entry.startsWith(direct + path.sep))
    throw Error('Archive extractor is outside its direct dependency in the attested runtime');
  return request(entry) as typeof import('tar');
}
