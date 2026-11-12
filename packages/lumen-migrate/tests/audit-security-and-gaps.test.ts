import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  rmSync,
  mkdirSync,
  existsSync,
  mkdtempSync,
  symlinkSync,
  realpathSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';

import { it, vi, expect, describe, afterEach } from 'vitest';

import {
  parseConfigFile,
  parseSidebarsFile,
  compareDirectories,
  runLumenMigrateCli,
  migrateMarkdownToPdx,
  convertDocusaurusConfig,
  autogenerateSidebarForDir,
  loadDocusaurusConfigFromDir,
  crawlDocumentationDirectory,
  parseDocusaurusConfigContent,
  parseDocusaurusSidebarsContent,
} from '../src/index.js';

describe('GAP-12, IA-10 & IA-12 Audit Suite (@omnitron-dev/lumen-migrate)', () => {
  afterEach(() => {
    process.exitCode = 0;
  });

  it('GAP-12: parses TypeScript config and nested sidebars via TypeScript AST without flattening categories', () => {
    const workDir = mkdtempSync(join(realpathSync(tmpdir()), 'lumen-migrate-gap12-'));
    try {
      const configTs = `import type { Config } from '@docusaurus/types';

const sharedMacros = {
  '\\\\Hilb': '\\\\mathcal{H}',
  '\\\\ket': '|#1\\\\rangle',
};

const config = {
  title: 'AST Parsed Docs',
  tagline: 'Full TypeScript AST extraction',
  url: 'https://ast.example.com',
  baseUrl: '/v2/',
  trailingSlash: false,
  onBrokenLinks: 'throw',
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'de', 'ru'],
  },
  presets: [
    [
      'classic',
      {
        docs: {
          rehypePlugins: [['rehype-katex', { macros: sharedMacros }]],
        },
      },
    ],
  ],
} satisfies Config;

export default config;
`;

      const sidebarsTs = `import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  tutorialSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Guides',
      collapsed: false,
      link: {
        type: 'generated-index',
        title: 'Guides Index',
        slug: '/category/guides',
      },
      items: [
        'guides/install',
        {
          type: 'category',
          label: 'Deep Nested',
          collapsed: true,
          items: ['guides/deep/leaf'],
        },
      ],
    },
  ],
};

export default sidebars as SidebarsConfig;
`;

      const configPath = join(workDir, 'docusaurus.config.ts');
      const sidebarsPath = join(workDir, 'sidebars.ts');
      writeFileSync(configPath, configTs, 'utf8');
      writeFileSync(sidebarsPath, sidebarsTs, 'utf8');

      const parsedConfig = parseConfigFile(configPath);
      expect(parsedConfig.title).toBe('AST Parsed Docs');
      expect(parsedConfig.baseUrl).toBe('/v2/');
      expect(parsedConfig.trailingSlash).toBe(false);
      expect(parsedConfig.i18n?.locales).toEqual(['en', 'de', 'ru']);
      expect(parsedConfig.katexMacros?.['\\Hilb']).toBe('\\mathcal{H}');
      expect(parsedConfig.katexMacros?.['\\ket']).toBe('|#1\\rangle');

      const parsedSidebars = parseSidebarsFile(sidebarsPath);
      const tutorial = parsedSidebars['tutorialSidebar'] as any[];
      expect(Array.isArray(tutorial)).toBe(true);
      expect(tutorial).toHaveLength(2);
      expect(tutorial[0]).toBe('intro');
      expect(tutorial[1]).toEqual({
        type: 'category',
        label: 'Guides',
        collapsed: false,
        link: {
          type: 'generated-index',
          title: 'Guides Index',
          slug: '/category/guides',
        },
        items: [
          'guides/install',
          {
            type: 'category',
            label: 'Deep Nested',
            collapsed: true,
            items: ['guides/deep/leaf'],
          },
        ],
      });

      const loaded = loadDocusaurusConfigFromDir(workDir);
      const converted = convertDocusaurusConfig(loaded.config, loaded.rawSidebars);
      const convertedTutorial = converted.sidebars['tutorialSidebar'] as any[];
      expect(convertedTutorial[1]?.type).toBe('category');
      expect(convertedTutorial[1]?.href).toBe('/category/guides');
      expect(convertedTutorial[1]?.items[1]?.label).toBe('Deep Nested');

      // Also verify CommonJS module.exports support
      const cjsSidebars = parseDocusaurusSidebarsContent(
        `module.exports = { api: [{ type: 'category', label: 'REST', items: ['endpoints'] }] };`
      );
      expect((cjsSidebars['api'] as any[])[0]?.label).toBe('REST');
      expect(parseDocusaurusConfigContent('module.exports = { title: "CJS Docs" };').title).toBe('CJS Docs');
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('IA-10: blocks executable ---js / ---javascript / ---coffee frontmatter engines across migrator, autogenerator, and crawler', () => {
    let sideEffectTriggered = false;
    (globalThis as any).__lumenMigrateExploit = () => {
      sideEffectTriggered = true;
      return { title: 'Pwned' };
    };

    const workDir = mkdtempSync(join(realpathSync(tmpdir()), 'lumen-migrate-ia10-'));
    try {
      const jsPayload = `---js
{
  title: globalThis.__lumenMigrateExploit()
}
---
# Malicious Doc
`;
      const coffeePayload = `---coffee
title: "Coffee Exploit"
---
# Coffee Doc
`;

      expect(() => migrateMarkdownToPdx(jsPayload)).toThrow(/disabled/i);
      expect(() => migrateMarkdownToPdx(coffeePayload)).toThrow(/disabled/i);
      expect(sideEffectTriggered).toBe(false);

      const docsDir = join(workDir, 'docs');
      mkdirSync(docsDir, { recursive: true });
      writeFileSync(join(docsDir, 'evil.md'), jsPayload, 'utf8');
      writeFileSync(
        join(docsDir, 'safe.md'),
        '---\ntitle: Safe Doc\nsidebar_position: 1\n---\n# Safe Heading\n',
        'utf8'
      );

      expect(() => autogenerateSidebarForDir(docsDir)).toThrow(/disabled/i);
      expect(() => crawlDocumentationDirectory(workDir)).toThrow(/disabled/i);
      rmSync(join(docsDir, 'evil.md'));
      const sidebarItems = autogenerateSidebarForDir(docsDir);
      expect(sideEffectTriggered).toBe(false);
      expect(sidebarItems).toEqual([{ type: 'doc', id: 'safe', label: 'Safe Doc' }]);

      const crawled = crawlDocumentationDirectory(workDir);
      expect(sideEffectTriggered).toBe(false);
      expect(crawled.routeUrls).toEqual(['/docs/safe']);
      expect(crawled.anchorUrls).toEqual(['/docs/safe#safe-heading']);
    } finally {
      delete (globalThis as any).__lumenMigrateExploit;
      rmSync(workDir, { recursive: true, force: true });
    }
  });

  it('IA-12: rejects symlinks escaping root, respects frontmatter slug/id, extracts automatic heading slugs, and fails empty directory parity', () => {
    const baseDir = mkdtempSync(join(realpathSync(tmpdir()), 'lumen-migrate-ia12-'));
    try {
      const outsideDir = join(baseDir, 'outside');
      const projectDir = join(baseDir, 'project');
      const docsDir = join(projectDir, 'docs');
      mkdirSync(outsideDir, { recursive: true });
      mkdirSync(join(docsDir, 'guides'), { recursive: true });

      writeFileSync(join(outsideDir, 'secret.md'), '# Outside Secret\n', 'utf8');
      symlinkSync(join(outsideDir, 'secret.md'), join(docsDir, 'escaped-secret.md'));

      writeFileSync(
        join(docsDir, 'guides', 'install-file.md'),
        `---
id: setup
title: Setup Guide
---

# Quick Setup

\`\`\`bash
# comment inside code block must be ignored
\`\`\`

## Custom Anchor {#custom-install-id}
`,
        'utf8'
      );

      writeFileSync(
        join(docsDir, 'guides', 'legacy.md'),
        `---
slug: /modern-overview
---

# Modern Overview
`,
        'utf8'
      );

      expect(() => crawlDocumentationDirectory(projectDir)).toThrow(/symlink/i);
      rmSync(join(docsDir, 'escaped-secret.md'));
      const crawled = crawlDocumentationDirectory(projectDir);
      expect(crawled.routeUrls).not.toContain('/docs/escaped-secret');
      expect(crawled.routeUrls).toContain('/docs/guides/setup');
      expect(crawled.routeUrls).toContain('/docs/modern-overview');
      expect(crawled.anchorUrls).toContain('/docs/guides/setup#quick-setup');
      expect(crawled.anchorUrls).toContain('/docs/guides/setup#custom-install-id');
      expect(crawled.anchorUrls.some((a) => a.includes('comment-inside-code-block'))).toBe(false);

      // Empty or non-existent source directory must NEVER report 100% parity
      const emptyDir = join(baseDir, 'empty-source');
      mkdirSync(emptyDir, { recursive: true });
      const emptyParity = compareDirectories(emptyDir, emptyDir);
      expect(emptyParity.passed).toBe(false);
      expect(emptyParity.parityScore).toBe(0);
    } finally {
      rmSync(baseDir, { recursive: true, force: true });
    }
  });

  it('IA-12: refuses missing input and existing output, and verifies a new project before publication', async () => {
    const baseDir = mkdtempSync(join(realpathSync(tmpdir()), 'lumen-migrate-cli-ia12-'));
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    try {
      // 1. Non-existent source directory sets exitCode = 1 and does not create target directory
      const missingSrc = join(baseDir, 'does-not-exist');
      const untouchedTarget = join(baseDir, 'untouched-target');
      process.exitCode = 0;
      await expect(runLumenMigrateCli(['docusaurus', missingSrc, untouchedTarget, '--json'])).rejects.toThrow(/ENOENT/);
      expect(process.exitCode).toBe(1);
      expect(existsSync(untouchedTarget)).toBe(false);

      // 2. An existing target is refused before any migration writes
      const badSrc = join(baseDir, 'bad-src');
      mkdirSync(join(badSrc, 'docs'), { recursive: true });
      writeFileSync(join(badSrc, 'docs', 'good.md'), '# Good\n', 'utf8');
      writeFileSync(join(badSrc, 'docs', 'bad.md'), '---js\n{ a: 1 }\n---\n# Bad\n', 'utf8');

      const protectedTarget = join(baseDir, 'protected-target');
      mkdirSync(protectedTarget, { recursive: true });
      writeFileSync(join(protectedTarget, 'sentinel.txt'), 'KEEP_ME', 'utf8');

      process.exitCode = 0;
      await expect(runLumenMigrateCli(['docusaurus', badSrc, protectedTarget, '--json'])).rejects.toThrow(
        /Target already exists/
      );
      expect(process.exitCode).toBe(1);
      expect(readFileSync(join(protectedTarget, 'sentinel.txt'), 'utf8')).toBe('KEEP_ME');
      expect(existsSync(join(protectedTarget, 'lumen.config.ts'))).toBe(false);

      // 3. Every valid migration requires successful staging parity
      const validSrc = join(baseDir, 'valid-src');
      mkdirSync(join(validSrc, 'docs'), { recursive: true });
      writeFileSync(join(validSrc, 'docusaurus.config.ts'), 'export default { title: "Atomic Site" };\n', 'utf8');
      writeFileSync(
        join(validSrc, 'docs', 'intro.md'),
        '---\ntitle: Intro\n---\n\n# Welcome\n\n## Getting Started\n',
        'utf8'
      );

      const cleanTarget = join(baseDir, 'clean-target');
      process.exitCode = 0;
      await runLumenMigrateCli(['docusaurus', validSrc, cleanTarget, '--json']);
      expect(process.exitCode).toBe(0);
      expect(existsSync(join(cleanTarget, 'lumen.config.ts'))).toBe(true);
      expect(existsSync(join(cleanTarget, 'docs', 'intro.pdx'))).toBe(true);
    } finally {
      logSpy.mockRestore();
      warnSpy.mockRestore();
      process.exitCode = 0;
      rmSync(baseDir, { recursive: true, force: true });
    }
  });
});
