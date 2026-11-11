import matter from 'gray-matter';
import { transformCallouts } from './callout-transformer.js';
import { stripThemeImports } from './tabs-transformer.js';
import { resolveLinks } from './link-resolver.js';

export function migrateMarkdownToPdx(content: string): string {
  let frontmatter: Record<string, any> = {};
  let body = content;

  // Attempt frontmatter extraction with error recovery
  try {
    if (content.startsWith('---')) {
      const secondDelimiter = content.indexOf('\n---', 3);
      if (secondDelimiter !== -1) {
        const parsed = matter(content);
        frontmatter = parsed.data ?? {};
        body = parsed.content ?? '';

        // Normalize sidebar_position to number if numeric string
        if (typeof frontmatter['sidebar_position'] === 'string') {
          const num = parseInt(frontmatter['sidebar_position'], 10);
          if (!isNaN(num)) {
            frontmatter['sidebar_position'] = num;
          }
        }
      } else {
        // Unclosed frontmatter delimiter recovery
        // Leave body intact
        body = content;
      }
    }
  } catch {
    body = content;
  }

  // Transform AST structures in markdown body
  body = transformCallouts(body);
  body = stripThemeImports(body);
  body = resolveLinks(body);

  // If we extracted valid frontmatter, format it back
  if (Object.keys(frontmatter).length > 0) {
    const yamlLines = Object.entries(frontmatter).map(([k, v]) => {
      if (typeof v === 'string') {
        if (/[:\n"'{}[\]#&*!|>%@`,?]/.test(v)) {
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
