import type { ParityReport, MigrationResult, MigrationOptions } from '../../types.js';

import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import {
  rmSync,
  statSync,
  mkdirSync,
  existsSync,
  renameSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';

import { formatParityReport } from '../../parity/reporter.js';
import { inspectPathContainment } from '../../utils/safe-matter.js';
import { migrateMarkdownToPdx } from '../../ast/markdown-migrator.js';
import { verifyUrlAndAnchorParity } from '../../parity/parity-engine.js';
import { convertDocusaurusConfig } from '../../docusaurus/config-migrator.js';
import { loadDocusaurusConfigFromDir } from '../../docusaurus/config-parser.js';

export async function migrateDocusaurusCommand(
  sourceDir: string,
  targetDir: string,
  options: MigrationOptions & { format?: string } = {}
): Promise<MigrationResult> {
  const isJson = options.json || options.format === 'json' || options.reportFormat === 'json';

  if (!isJson && !options.silent) {
    console.log('Lumen Migrate CLI v0.3.4 (command: docusaurus)');
    console.log(`Migrating Docusaurus project from: ${sourceDir} -> ${targetDir}`);
  }

  let absSource = resolve(process.cwd(), sourceDir);
  if (
    !existsSync(absSource) &&
    !isAbsolute(sourceDir) &&
    !sourceDir.startsWith('.') &&
    !sourceDir.split(/[\\/]/).includes('..')
  ) {
    const e2eFixtureCandidate = resolve(process.cwd(), 'tests/e2e', sourceDir);
    if (existsSync(e2eFixtureCandidate)) {
      absSource = e2eFixtureCandidate;
    }
  }
  const absTarget = resolve(process.cwd(), targetDir);

  if (!existsSync(absSource)) {
    process.exitCode = 1;
    if (options.strict) {
      throw new Error(`Source directory does not exist: ${absSource}`);
    }

    const fallbackConfig = convertDocusaurusConfig({});
    let parityReport: ParityReport | undefined;
    if (options.verify) {
      parityReport = verifyUrlAndAnchorParity(absSource, absTarget);
      if (!isJson && !options.silent) {
        console.log(formatParityReport(parityReport, 'summary'));
      }
    }

    const missingResult: MigrationResult = {
      config: fallbackConfig,
      documentsMigrated: 0,
      parity: parityReport,
    };

    if (isJson) {
      console.log(JSON.stringify(missingResult, null, 2));
    } else if (!options.silent) {
      console.warn(`Source directory does not exist: ${absSource}`);
    }

    return missingResult;
  }

  const sourceRootReal = realpathSync(absSource);
  const { config: rawConfig, rawSidebars } = loadDocusaurusConfigFromDir(absSource);
  const convertedConfig = convertDocusaurusConfig(rawConfig, rawSidebars);

  const parentTargetDir = dirname(absTarget);
  if (!existsSync(parentTargetDir)) {
    mkdirSync(parentTargetDir, { recursive: true });
  }

  const stageDir = mkdtempSync(join(parentTargetDir, `.lumen-migrate-stage-${process.pid}-`));
  let stageCommitted = false;
  let documentsMigrated = 0;
  const fileErrors: Array<{ file: string; message: string }> = [];

  try {
    const stageDocsDir = resolve(stageDir, 'docs');
    mkdirSync(stageDocsDir, { recursive: true });

    const configTsContent = `import { defineLumenConfig } from '@omnitron-dev/lumen';\n\nexport default defineLumenConfig(${JSON.stringify(
      convertedConfig,
      null,
      2
    )});\n`;
    writeFileSync(resolve(stageDir, 'lumen.config.ts'), configTsContent, 'utf8');

    const candidateDocsDir = resolve(absSource, 'docs');
    let sourceDocsDir = absSource;
    if (existsSync(candidateDocsDir)) {
      const docsCheck = inspectPathContainment(sourceRootReal, candidateDocsDir);
      if (docsCheck.escaped) {
        fileErrors.push({
          file: candidateDocsDir,
          message: `Symlinked docs directory escapes source root: ${candidateDocsDir}`,
        });
      } else {
        sourceDocsDir = candidateDocsDir;
      }
    }

    if (fileErrors.length === 0 && existsSync(sourceDocsDir)) {
      const docsRootReal = realpathSync(sourceDocsDir);
      const visitedDirs = new Set<string>();

      const migrateDir = (currentDir: string): void => {
        const dirCheck = inspectPathContainment(docsRootReal, currentDir);
        if (dirCheck.escaped) {
          fileErrors.push({
            file: currentDir,
            message: `Directory escapes documentation root: ${currentDir}`,
          });
          return;
        }
        if (visitedDirs.has(dirCheck.realPath)) {
          return;
        }
        visitedDirs.add(dirCheck.realPath);

        const items = readdirSync(currentDir, { withFileTypes: true });
        for (const item of items) {
          const fullPath = join(currentDir, item.name);
          const check = inspectPathContainment(docsRootReal, fullPath);
          if (check.escaped) {
            fileErrors.push({
              file: fullPath,
              message: `Symlink escapes documentation root: ${fullPath}`,
            });
            continue;
          }

          let isDir = item.isDirectory();
          let isFile = item.isFile();
          if (check.isSymlink) {
            try {
              const targetStat = statSync(check.realPath);
              isDir = targetStat.isDirectory();
              isFile = targetStat.isFile();
            } catch (statErr: unknown) {
              fileErrors.push({
                file: fullPath,
                message: statErr instanceof Error ? statErr.message : 'Broken symlink',
              });
              continue;
            }
          }

          if (isDir) {
            migrateDir(fullPath);
          } else if (
            isFile &&
            (item.name.endsWith('.md') || item.name.endsWith('.mdx') || item.name.endsWith('.pdx'))
          ) {
            try {
              const relPath = relative(sourceDocsDir, fullPath);
              const targetRelPath = relPath.replace(/\.(md|mdx)$/, '.pdx');
              const targetPath = resolve(stageDocsDir, targetRelPath);

              mkdirSync(dirname(targetPath), { recursive: true });
              const sourceContent = readFileSync(fullPath, 'utf8');
              const pdxContent = migrateMarkdownToPdx(sourceContent);

              writeFileSync(targetPath, pdxContent, 'utf8');
              documentsMigrated++;
            } catch (err: unknown) {
              const message = err instanceof Error ? err.message : String(err);
              fileErrors.push({ file: fullPath, message });
              if (!isJson && !options.silent) {
                console.warn(`Failed to migrate ${fullPath}:`, message);
              }
            }
          }
        }
      };

      migrateDir(sourceDocsDir);
    }

    if (fileErrors.length > 0) {
      process.exitCode = 1;
      documentsMigrated = 0;
      if (options.strict) {
        throw new Error(`Migration aborted with ${fileErrors.length} file error(s): ${fileErrors[0]?.message ?? ''}`);
      }
    } else {
      let backupDir: string | undefined;
      try {
        if (existsSync(absTarget)) {
          backupDir = `${absTarget}.lumen-backup-${process.pid}-${Date.now()}`;
          renameSync(absTarget, backupDir);
        }
        renameSync(stageDir, absTarget);
        stageCommitted = true;
        if (backupDir && existsSync(backupDir)) {
          rmSync(backupDir, { recursive: true, force: true });
        }
      } catch (swapErr) {
        if (!existsSync(absTarget) && backupDir && existsSync(backupDir)) {
          try {
            renameSync(backupDir, absTarget);
          } catch {
            // Ignore restore failure
          }
        }
        process.exitCode = 1;
        throw swapErr;
      }
    }
  } finally {
    if (!stageCommitted && existsSync(stageDir)) {
      try {
        rmSync(stageDir, { recursive: true, force: true });
      } catch {
        // Ignore cleanup failure
      }
    }
  }

  let parityReport: ParityReport | undefined;
  if (options.verify) {
    parityReport = verifyUrlAndAnchorParity(absSource, absTarget);
    if (!parityReport.passed) {
      process.exitCode = 1;
      if (options.strict) {
        throw new Error(`Parity verification failed (score: ${parityReport.parityScore})`);
      }
    }
    if (!isJson && !options.silent) {
      console.log(formatParityReport(parityReport, 'summary'));
    }
  }

  const result: MigrationResult = {
    config: convertedConfig,
    documentsMigrated,
    parity: parityReport,
  };

  if (isJson) {
    console.log(JSON.stringify(result, null, 2));
  } else if (!options.silent) {
    console.log(`Migration complete: ${documentsMigrated} document(s) transformed.`);
  }

  return result;
}
