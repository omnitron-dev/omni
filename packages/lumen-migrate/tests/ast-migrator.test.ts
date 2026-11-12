import { describe, it, expect } from 'vitest';
import { transformCallouts } from '../src/ast/callout-transformer.js';
import { stripThemeImports } from '../src/ast/tabs-transformer.js';
import { resolveLinks } from '../src/ast/link-resolver.js';
import { migrateMarkdownToPdx } from '../src/ast/markdown-migrator.js';

describe('AST Migrator', () => {
  it('preserves valid frontmatter bytes and scalar types without reserialization', () => {
    const prefix = '---\ntitle: "true"\ncustom: "007"\n"key: punctuation": "value"\n# Keep this comment\n---\n\n';
    expect(migrateMarkdownToPdx(prefix + ':::tip Helpful\nBody\n:::')).toBe(
      prefix + ':::tip{title="Helpful"}\nBody\n:::'
    );
  });
  it('normalizes admonition titles to {title="..."}', () => {
    const raw = `:::tip Optimization Tip\ncontent\n:::`;
    const transformed = transformCallouts(raw);
    expect(transformed).toContain(':::tip{title="Optimization Tip"}');
  });

  it('normalizes bracketed admonition titles', () => {
    const raw = `:::warning[Deprecation Alert]\ncontent\n:::`;
    const transformed = transformCallouts(raw);
    expect(transformed).toContain(':::warning{title="Deprecation Alert"}');
  });

  it('strips theme and docusaurus imports while preserving JSX elements', () => {
    const raw = `import Tabs from '@theme/Tabs';\nimport TabItem from '@theme/TabItem';\n\n<Tabs>\n  <TabItem value="pnpm">pnpm</TabItem>\n</Tabs>`;
    const stripped = stripThemeImports(raw);
    expect(stripped).not.toContain('@theme/Tabs');
    expect(stripped).not.toContain('@theme/TabItem');
    expect(stripped).toContain('<Tabs>');
    expect(stripped).toContain('<TabItem value="pnpm">');
  });

  it('resolves relative markdown links to clean route paths', () => {
    const raw = `[Guide](./guides/installation.md#quick-start)`;
    const resolved = resolveLinks(raw);
    expect(resolved).toBe('[Guide](./guides/installation#quick-start)');
  });

  it('preserves Cyrillic custom heading anchors {#...}', () => {
    const raw = `## Обзор {#обзор-системы}`;
    const pdx = migrateMarkdownToPdx(raw);
    expect(pdx).toContain('{#обзор-системы}');
  });

  it('preserves unescaped curly braces in prose', () => {
    const raw = `Expressions like {user.name} or {new Date().getFullYear()}.`;
    const pdx = migrateMarkdownToPdx(raw);
    expect(pdx).toContain('{user.name}');
    expect(pdx).toContain('{new Date().getFullYear()}');
  });
});
