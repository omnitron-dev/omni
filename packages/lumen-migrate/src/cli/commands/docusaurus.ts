import type { MigrationResult, MigrationOptions } from '../../types.js';

import { dirname, join, relative, resolve, sep } from 'node:path';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';

import { formatParityReport } from '../../parity/reporter.js';
import { crawlDocumentationInventory } from '../../parity/crawler.js';
import { migrateMarkdownToPdx } from '../../ast/markdown-migrator.js';
import { compareUrlArrays } from '../../parity/parity-engine.js';
import { convertDocusaurusConfig } from '../../docusaurus/config-migrator.js';
import { loadDocusaurusConfigFromDir } from '../../docusaurus/config-parser.js';
import {
  assertFileUnchanged,
  assertInventoryUnchanged,
  directoryStamp,
  documentationRoot,
  documentationText,
  inventoryDocumentation,
  isDocumentationFile,
  nativeDirectoryIdentity,
  pathExists,
  physicalDirectory,
  type DocumentationFile,
  type DocumentationInventory,
} from '../../utils/documentation-files.js';

function within(root: string, candidate: string): boolean {
  return candidate === root || candidate.startsWith(root.endsWith(sep) ? root : root + sep);
}

function assertDirectory(directory: string, identity: string): void {
  if (physicalDirectory(directory) !== directory || nativeDirectoryIdentity(directory) !== identity)
    throw Error('Directory identity changed during migration: ' + directory);
}

/** Create only new entries. Never rename over, remove, or truncate a destination. */
function writeNewTree(
  root: string,
  directories: string[],
  files: Array<{ relativePath: string; content: Buffer }>
): void {
  const identities = new Map<string, string>([['', nativeDirectoryIdentity(root)]]);
  const checkParents = (path: string): void => {
    let current = dirname(path);
    while (within(root, current)) {
      const expected = identities.get(relative(root, current));
      if (!expected) throw Error('Unowned output directory: ' + current);
      assertDirectory(current, expected);
      if (current === root) break;
      current = dirname(current);
    }
  };
  for (const directory of directories) {
    if (!directory) continue;
    const destination = join(root, directory);
    checkParents(destination);
    mkdirSync(destination, { mode: 0o700 });
    identities.set(directory, nativeDirectoryIdentity(destination));
  }
  for (const file of files) {
    const destination = join(root, file.relativePath);
    checkParents(destination);
    writeFileSync(destination, file.content, { flag: 'wx', mode: 0o600 });
  }
  for (const [directory, identity] of identities) assertDirectory(join(root, directory), identity);
}

function assertCopiedTree(stage: DocumentationInventory, target: string, identity: string): void {
  assertDirectory(target, identity);
  const copy = inventoryDocumentation(target);
  if (
    copy.directories.size !== stage.directories.size ||
    copy.files.length !== stage.files.length ||
    [...stage.directories.keys()].some((directory) => !copy.directories.has(directory)) ||
    stage.files.some(
      (file, index) =>
        copy.files[index]?.relativePath !== file.relativePath || !copy.files[index]?.content.equals(file.content)
    )
  )
    throw Error('Published project differs from verified staging: ' + target);
}

export async function migrateDocusaurusCommand(
  sourceDir: string,
  targetDir: string,
  options: MigrationOptions = {}
): Promise<MigrationResult> {
  const source = physicalDirectory(resolve(sourceDir));
  const target = resolve(targetDir);
  if (within(source, target) || within(target, source))
    throw Error('Source and target must be separate, non-overlapping directories');
  if (pathExists(target)) throw Error('Target already exists; choose a new directory: ' + target);
  const parent = physicalDirectory(dirname(target));
  const parentIdentity = nativeDirectoryIdentity(parent);
  const sourceStamp = directoryStamp(source);
  const configFiles: DocumentationFile[] = [];
  const { config: rawConfig, rawSidebars } = loadDocusaurusConfigFromDir(source, (file) => configFiles.push(file));
  const config = convertDocusaurusConfig(rawConfig, rawSidebars);
  const sourceInventory = inventoryDocumentation(documentationRoot(source));
  const sourceUrls = crawlDocumentationInventory(sourceInventory);
  if (!sourceUrls.routeUrls.length) throw Error('Source contains no documentation files: ' + sourceInventory.root);

  // Admission covers all files and directories, including assets and empty directories.
  const directories = [
    'docs',
    ...[...sourceInventory.directories.keys()].filter(Boolean).map((path) => join('docs', path)),
  ];
  const files = sourceInventory.files.map((file) => ({
    relativePath: join('docs', file.relativePath.replace(/\.(md|mdx|pdx)$/i, '.pdx')),
    content: isDocumentationFile(file.relativePath)
      ? Buffer.from(migrateMarkdownToPdx(documentationText(file)))
      : file.content,
  }));
  files.push({
    relativePath: 'lumen.config.ts',
    content: Buffer.from(
      `import { defineLumenConfig } from '@omnitron-dev/lumen';\n\nexport default defineLumenConfig(${JSON.stringify(config, null, 2)});\n`
    ),
  });
  // Case/Unicode collisions must also be rejected on a case-sensitive source volume.
  const outputPaths = new Set<string>();
  for (const path of [...directories, ...files.map((file) => file.relativePath)]) {
    const canonical = path.normalize('NFC').toLowerCase();
    if (outputPaths.has(canonical)) throw Error('Colliding migration output path: ' + path);
    outputPaths.add(canonical);
  }

  assertDirectory(parent, parentIdentity);
  const stage = mkdtempSync(join(parent, '.lumen-migrate-stage-'));
  const stageIdentity = nativeDirectoryIdentity(stage);
  let claimed = false;
  try {
    writeNewTree(stage, directories, files);
    const staged = inventoryDocumentation(stage);
    const stageUrls = crawlDocumentationInventory(inventoryDocumentation(join(stage, 'docs')));
    const parity = compareUrlArrays(sourceUrls.allUrls, stageUrls.allUrls);
    if (!parity.passed)
      throw Error(
        'Staged migration failed route and anchor parity: ' +
          JSON.stringify({ routes: parity.missingRoutes, anchors: parity.missingAnchors })
      );

    assertInventoryUnchanged(sourceInventory);
    configFiles.forEach(assertFileUnchanged);
    if (directoryStamp(source) !== sourceStamp) throw Error('Source directory changed during migration: ' + source);
    assertInventoryUnchanged(staged);
    assertDirectory(parent, parentIdentity);
    if (pathExists(target)) throw Error('Target appeared during migration; preserving it: ' + target);

    // mkdir is an exclusive claim, unlike a portable directory rename which can
    // replace another writer's empty directory. A failed copy stays visible.
    mkdirSync(target, { mode: 0o700 });
    claimed = true;
    const targetIdentity = nativeDirectoryIdentity(target);
    writeNewTree(target, [...staged.directories.keys()], staged.files);
    assertCopiedTree(staged, target, targetIdentity);

    assertDirectory(stage, stageIdentity);
    assertInventoryUnchanged(staged);
    rmSync(stage, { recursive: true });
    const result: MigrationResult = { config, documentsMigrated: sourceUrls.routeUrls.length, parity };
    if (options.json) console.log(JSON.stringify(result, null, 2));
    else if (!options.silent) {
      console.log(`Created migrated project: ${target} (${result.documentsMigrated} documents)`);
      console.log(formatParityReport(parity, 'summary'));
    }
    return result;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw new Error(
      `${message}\nStaging path (retained when present): ${stage}\n${claimed ? 'Claimed target may be incomplete; inspect it before removal' : 'Target was not claimed by this migration'}: ${target}`,
      { cause }
    );
  }
}
