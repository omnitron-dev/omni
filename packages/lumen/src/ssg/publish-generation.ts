import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { computeContentHash } from '../manifest/hashing.js';

export type StaticFile = string | Uint8Array;

/** Publish only a complete generation. Failed writes leave the admitted tree intact. */
export function publishGeneration(outDir: string, files: ReadonlyMap<string, StaticFile>): string[] {
  const target = resolve(outDir);
  if (target === dirname(target)) throw new Error('Cannot publish a site over a filesystem root');
  if (existsSync(target)) {
    if (lstatSync(target).isSymbolicLink() || !lstatSync(target).isDirectory())
      throw new Error('Output must be a real directory');
    const proof = join(target, '.lumen-generation.json');
    if (!existsSync(proof))
      throw new Error('Existing output is not a Lumen generation; select an empty output directory');
    if (JSON.parse(readFileSync(proof, 'utf8')).generator !== '@omnitron-dev/lumen')
      throw new Error('Output ownership is invalid');
  }
  mkdirSync(dirname(target), { recursive: true });
  const stage = mkdtempSync(join(dirname(target), `.${basename(target)}-stage-`));
  const backup = `${stage}.previous`;
  let previousMoved = false;
  const inventory: Record<string, { bytes: number; sha256: string }> = {};
  try {
    for (const [path, content] of files) {
      if (
        !path ||
        isAbsolute(path) ||
        path.includes('\\') ||
        path.split('/').some((part) => !part || part === '.' || part === '..')
      )
        throw new Error(`Unsafe output path: ${path}`);
      if (path === '.lumen-generation.json') throw new Error('Reserved output inventory path');
      const destination = resolve(stage, path);
      if (!destination.startsWith(stage + sep)) throw new Error(`Output path escapes generation: ${path}`);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, content);
      inventory[path] = { bytes: Buffer.byteLength(content), sha256: computeContentHash(content, 0) };
    }
    writeFileSync(
      join(stage, '.lumen-generation.json'),
      JSON.stringify({ generator: '@omnitron-dev/lumen', files: inventory }, null, 2)
    );
    if (existsSync(target)) {
      renameSync(target, backup);
      previousMoved = true;
    }
    try {
      renameSync(stage, target);
    } catch (error) {
      if (previousMoved) renameSync(backup, target);
      throw error;
    }
    if (previousMoved) rmSync(backup, { recursive: true });
    return [...files.keys(), '.lumen-generation.json'];
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
