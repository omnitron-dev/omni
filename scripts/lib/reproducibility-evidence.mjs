import fs from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';

const MAX_PACKAGES = 64, MAX_DIFFERENCES = 256, MAX_ARCHIVE_BYTES = 256 * 1024 * 1024;
const metadata = pkg => pkg ? Object.fromEntries(
  ['name', 'version', 'filename', 'sha256', 'integrity'].filter(key => Object.hasOwn(pkg, key)).map(key => [key, pkg[key]])) : null;
const observed = (pkg, file) => pkg && Object.hasOwn(pkg.files, file) ? pkg.files[file] : null;

/** Diagnostics only. The caller still compares the exact runtime and SDK digests. */
export function sdkDifferences(first = [], second = []) {
  const before = new Map(first.map(pkg => [pkg.name, pkg]));
  const after = new Map(second.map(pkg => [pkg.name, pkg]));
  const differences = [];
  let packages = 0, files = 0, reportedFiles = 0;
  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const a = before.get(name), b = after.get(name);
    if (isDeepStrictEqual(a, b)) continue;
    packages++;
    const changed = [];
    let fileCount = 0;
    for (const file of [...new Set([...Object.keys(a?.files ?? {}), ...Object.keys(b?.files ?? {})])].sort()) {
      const original = observed(a, file), rebuilt = observed(b, file);
      if (isDeepStrictEqual(original, rebuilt)) continue;
      fileCount++; files++;
      if (reportedFiles < MAX_DIFFERENCES && differences.length < MAX_PACKAGES) {
        changed.push({ file, first: original, second: rebuilt });
        reportedFiles++;
      }
    }
    if (differences.length < MAX_PACKAGES) {
      differences.push({ name, first: metadata(a), second: metadata(b), files: fileCount,
        differences: changed, omittedFiles: fileCount - changed.length });
    }
  }
  return { packages, files, differences, omittedPackages: packages - differences.length };
}

/** Keep only public, already inspected npm archives; never copy a build tree,
 * environment, dependency store or application state into CI diagnostics. */
export async function preserveReproducibilityFailure(directory, evidence, roots) {
  const sdk = sdkDifferences(evidence.first?.sdkInventory, evidence.second?.sdkInventory);
  const archives = [];
  let bytes = 0;
  for (const round of ['first', 'second']) if (roots[round]) {
    try {
      await fs.copyFile(path.join(roots[round], 'framework-manifest.json'),
        path.join(directory, round + '-framework-manifest.json'), fs.constants.COPYFILE_EXCL);
    } catch (error) {
      // Packing may fail before the complete manifest exists.
      if (error.code !== 'ENOENT') throw error;
    }
  }
  for (const difference of sdk.differences) for (const round of ['first', 'second']) {
    const pkg = difference[round], root = roots[round];
    if (!pkg || !root) continue;
    if (typeof pkg.filename !== 'string' || path.basename(pkg.filename) !== pkg.filename)
      throw Error('Invalid SDK diagnostic archive path');
    const source = path.join(root, pkg.filename);
    const stat = await fs.lstat(source);
    if (!stat.isFile()) throw Error('SDK diagnostic archive is not a regular file');
    if (bytes + stat.size > MAX_ARCHIVE_BYTES) {
      archives.push({ round, filename: pkg.filename, bytes: stat.size, retained: false, reason: 'archive byte limit' });
      continue;
    }
    await fs.mkdir(path.join(directory, round), { recursive: true });
    await fs.copyFile(source, path.join(directory, round, pkg.filename), fs.constants.COPYFILE_EXCL);
    bytes += stat.size;
    archives.push({ round, filename: pkg.filename, bytes: stat.size, retained: true });
  }
  // Complete inventories live separately, keeping the console receipt bounded.
  const result = round => round && { result: round.result };
  const report = { ...evidence, first: result(evidence.first), second: result(evidence.second), sdk, archives, archiveBytes: bytes,
    limits: { packages: MAX_PACKAGES, differences: MAX_DIFFERENCES, archiveBytes: MAX_ARCHIVE_BYTES } };
  await fs.writeFile(path.join(directory, 'failure.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  return report;
}
