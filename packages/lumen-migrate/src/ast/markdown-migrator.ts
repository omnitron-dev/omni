import { resolveLinks } from './link-resolver.js';
import { stripThemeImports } from './tabs-transformer.js';
import { transformCallouts } from './callout-transformer.js';
import { parseSafeFrontmatter, DisabledFrontmatterEngineError } from '../utils/safe-matter.js';

export function migrateMarkdownToPdx(content: string): string {
  let frontmatter: Record<string, unknown> = {};
  let body = content;

  // Attempt safe data-only YAML frontmatter extraction with error recovery for malformed YAML
  try {
    if (content.startsWith('---')) {
      const secondDelimiter = content.indexOf('\n---', 3);
      if (secondDelimiter !== -1) {
        const parsed = parseSafeFrontmatter(content);
        frontmatter = { ...parsed.data };
        body = parsed.content;

        // Normalize sidebar_position to number if numeric string
        if (typeof frontmatter['sidebar_position'] === 'string') {
          const num = parseInt(frontmatter['sidebar_position'], 10);
          if (!Number.isNaN(num)) {
            frontmatter['sidebar_position'] = num;
          }
        }
      } else {
        // Unclosed frontmatter delimiter recovery: leave body intact
        body = content;
      }
    }
  } catch (err) {
    if (err instanceof DisabledFrontmatterEngineError) {
      throw err;
    }
    body = content;
  }

  // Transform AST structures in markdown body
  body = transformCallouts(body);
  body = stripThemeImports(body);
  body = resolveLinks(body);

  // If we extracted valid frontmatter, format it back safely
  if (Object.keys(frontmatter).length > 0) {
    const yamlLines = Object.entries(frontmatter).map(([k, v]) => {
      if (typeof v === 'string') {
        if (/[:\n"'{}[\]#&*!|>%@`,?]/.test(v) || v.trim() !== v || v === '') {
          return `${k}: ${JSON.stringify(v)}`;
        }
        return `${k}: ${v}`;
      }
      return `${k}: ${JSON.stringify(v)}`;
    });

    const frontmatterBlock = `---\n${yamlLines.join('\n')}\n---\n\n`;
    return `${frontmatterBlock}${body.trimStart()}`;
  }

  return body;
}
