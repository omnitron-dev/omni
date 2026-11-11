import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative, join, dirname } from 'node:path';
import { loadDocusaurusConfigFromDir } from '../../docusaurus/config-parser.js';
import { convertDocusaurusConfig } from '../../docusaurus/config-migrator.js';
import { migrateMarkdownToPdx } from '../../ast/markdown-migrator.js';
import { verifyUrlAndAnchorParity } from '../../parity/parity-engine.js';
import { formatParityReport } from '../../parity/reporter.js';
import type { MigrationOptions, MigrationResult } from '../../types.js';

export async function migrateDocusaurusCommand(
  sourceDir: string,
  targetDir: string,
  options: MigrationOptions & { format?: string } = {}
): Promise<MigrationResult> {
  const isJson = options.json || options.format === 'json' || options.reportFormat === 'json';

  if (!isJson && !options.silent) {
    console.log(`Lumen Migrate CLI v0.3.4 (command: docusaurus)`);
    console.log(`Migrating Docusaurus project from: ${sourceDir} -> ${targetDir}`);
  }

  const absSource = resolve(process.cwd(), sourceDir);
  const absTarget = resolve(process.cwd(), targetDir);

  // 1. Load and convert Docusaurus configuration
  const { config: rawConfig, rawSidebars } = loadDocusaurusConfigFromDir(absSource);
  const convertedConfig = convertDocusaurusConfig(rawConfig, rawSidebars);

  // 2. Prepare target directory
  if (!existsSync(absTarget)) {
    mkdirSync(absTarget, { recursive: true });
  }

  const targetDocsDir = resolve(absTarget, 'docs');
  if (!existsSync(targetDocsDir)) {
    mkdirSync(targetDocsDir, { recursive: true });
  }

  // 3. Write target lumen.config.ts
  const configTsContent = `import { defineLumenConfig } from '@omnitron-dev/lumen';\n\nexport default defineLumenConfig(${JSON.stringify(
    convertedConfig,
    null,
    2
  )});\n`;
  writeFileSync(resolve(absTarget, 'lumen.config.ts'), configTsContent, 'utf8');

  // 4. Migrate documentation files (.md, .mdx -> .pdx)
  let documentsMigrated = 0;
  const sourceDocsDir = existsSync(resolve(absSource, 'docs')) ? resolve(absSource, 'docs') : absSource;

  if (existsSync(sourceDocsDir)) {
    const migrateDir = (currentDir: string) => {
      const items = readdirSync(currentDir, { withFileTypes: true });
      for (const item of items) {
        const fullPath = join(currentDir, item.name);
        if (item.isDirectory()) {
          migrateDir(fullPath);
        } else if (
          item.isFile() &&
          (item.name.endsWith('.md') || item.name.endsWith('.mdx') || item.name.endsWith('.pdx'))
        ) {
          try {
            const relPath = relative(sourceDocsDir, fullPath);
            const targetRelPath = relPath.replace(/\.(md|mdx)$/, '.pdx');
            const targetPath = resolve(targetDocsDir, targetRelPath);

            mkdirSync(dirname(targetPath), { recursive: true });
            const sourceContent = readFileSync(fullPath, 'utf8');
            const pdxContent = migrateMarkdownToPdx(sourceContent);

            writeFileSync(targetPath, pdxContent, 'utf8');
            documentsMigrated++;
          } catch (err: any) {
            if (!isJson && !options.silent) {
              console.warn(`Failed to migrate ${fullPath}:`, err?.message);
            }
          }
        }
      }
    };

    migrateDir(sourceDocsDir);
  }

  // 5. Parity verification if requested
  let parityReport;
  if (options.verify) {
    parityReport = verifyUrlAndAnchorParity(absSource, absTarget);
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
