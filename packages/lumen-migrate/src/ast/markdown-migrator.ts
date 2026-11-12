import { resolveLinks } from './link-resolver.js';
import { stripThemeImports } from './tabs-transformer.js';
import { transformCallouts } from './callout-transformer.js';
import { parseSafeFrontmatter } from '../utils/safe-matter.js';

export function migrateMarkdownToPdx(content: string): string {
  const parsed = parseSafeFrontmatter(content);
  // Validation uses the shared parser; keeping the original metadata bytes also
  // preserves YAML string types, custom keys and comments without reserializing.
  const prefix = content.slice(0, content.length - parsed.content.length);
  const body = resolveLinks(stripThemeImports(transformCallouts(parsed.content)));
  return prefix + body;
}
