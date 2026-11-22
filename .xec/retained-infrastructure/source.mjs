/** Public fixed entry delivered to a legacy source by its registered operator. */
import fs from 'node:fs';
import { runRetainedReview } from './review.mjs';
import { runSourceOperation } from './operation.mjs';

async function main() {
  const [mode, file, expected, runtimeRoot, runtimeManifestSha256, optionsFile, rawFd] = process.argv.slice(2);
  if (!['review', 'seal', 'create-stopped'].includes(mode) || !file || !expected || !runtimeRoot || !runtimeManifestSha256 ||
      !optionsFile || process.argv.length > 9) throw Error('Invalid retained infrastructure invocation');
  const options = JSON.parse(fs.readFileSync(optionsFile, 'utf8'));
  if (Object.keys(options).some(k => !['directory', 'volumeRoot', 'seal', 'nodeStop', 'publicSupplement'].includes(k)))
    throw Error('Only declared source operation options are supported');
  const input = { ...options, declaration: fs.readFileSync(file), expected, runtimeRoot, runtimeManifestSha256,
    ...(rawFd === undefined ? {} : { credentialsFd: Number(rawFd) }) };
  const result = mode === 'review' ? await runRetainedReview(input) : await runSourceOperation(mode, input);
  process.stdout.write(JSON.stringify(result) + '\n');
}

main().catch(() => { process.stderr.write('The selected retained infrastructure operation was not confirmed.\n'); process.exitCode = 1; });
