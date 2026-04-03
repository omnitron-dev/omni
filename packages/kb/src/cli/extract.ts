#!/usr/bin/env node

/**
 * kb-extract — Build-time CLI for extracting API surface from TypeScript packages.
 *
 * Usage:
 *   kb-extract                    # Extract from CWD (reads kb/kb.config.ts)
 *   kb-extract --root /path       # Extract from specific package root
 *   kb-extract --out kb/generated # Custom output directory
 *
 * Called automatically via postbuild hook or turbo task.
 */

import { resolve, join } from 'node:path';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { TsMorphExtractor } from '../extractors/ts-morph/ts-morph.extractor.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const outIndex = args.indexOf('--out');

  const packageRoot = rootIndex >= 0 ? resolve(args[rootIndex + 1]!) : process.cwd();
  const outDir = outIndex >= 0
    ? resolve(args[outIndex + 1]!)
    : resolve(packageRoot, 'kb', 'generated');

  // Load kb config
  const configPath = resolve(packageRoot, 'kb', 'kb.config.ts');
  let config;
  try {
    const imported = await import(configPath);
    config = imported.default ?? imported;
  } catch (err) {
    console.error(`[kb-extract] No kb/kb.config.ts found at ${packageRoot}`);
    process.exit(1);
  }

  // Load package.json
  const pkgJsonPath = resolve(packageRoot, 'package.json');
  let packageName = config.module;
  let packageVersion = '0.0.0';
  try {
    const pkg = JSON.parse(await readFile(pkgJsonPath, 'utf-8'));
    packageName = pkg.name ?? packageName;
    packageVersion = pkg.version ?? packageVersion;
  } catch {
    // Use defaults
  }

  if (!config.extract.symbols) {
    console.log(`[kb-extract] Symbols extraction disabled for ${packageName}, skipping`);
    process.exit(0);
  }

  console.log(`[kb-extract] Extracting from ${packageName}...`);
  const startTime = Date.now();

  const extractor = new TsMorphExtractor();
  const result = await extractor.extract({
    packageRoot,
    config,
    packageName,
    packageVersion,
  });

  // Write output
  await mkdir(outDir, { recursive: true });

  await Promise.all([
    writeFile(
      join(outDir, 'symbols.json'),
      JSON.stringify(result.symbols, null, 2),
    ),
    writeFile(
      join(outDir, 'decorators.json'),
      JSON.stringify(result.decorators, null, 2),
    ),
    writeFile(
      join(outDir, 'dependencies.json'),
      JSON.stringify(result.dependencies, null, 2),
    ),
    writeFile(
      join(outDir, 'repo-map.json'),
      JSON.stringify(result.repoMap, null, 2),
    ),
    writeFile(
      join(outDir, 'manifest.json'),
      JSON.stringify(result.manifest, null, 2),
    ),
  ]);

  const elapsed = Date.now() - startTime;
  console.log(
    `[kb-extract] Done: ${result.symbols.length} symbols, ` +
    `${Object.keys(result.decorators).length} decorator types, ` +
    `${result.dependencies.length} dependencies ` +
    `(${elapsed}ms)`,
  );
}

main().catch((err) => {
  console.error('[kb-extract] Fatal error:', err);
  process.exit(1);
});
