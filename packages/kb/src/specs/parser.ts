import matter from 'gray-matter';
import type { ISpecDoc, ISpecFrontmatter, IGotchaDoc, IPatternDoc } from '../core/types.js';

/**
 * Parses markdown spec files with YAML frontmatter into structured documents.
 */
export class SpecsParser {
  /**
   * Parse a spec markdown file into a structured document.
   */
  parseSpec(content: string, filePath: string): ISpecDoc {
    const { data, content: body } = matter(content);
    const fm = data as Partial<ISpecFrontmatter>;

    return {
      module: fm.module ?? this.inferModuleFromPath(filePath),
      title: fm.title ?? this.inferTitleFromContent(body),
      content: body.trim(),
      tags: fm.tags ?? [],
      summary: fm.summary ?? '',
      filePath,
      dependsOn: fm.depends_on ?? [],
      tokens: this.estimateTokens(body),
    };
  }

  /**
   * Parse a gotcha markdown file.
   * Gotcha files use extended frontmatter: severity, module (optional).
   */
  parseGotcha(content: string, filePath: string): IGotchaDoc {
    const { data, content: body } = matter(content);
    const fm = data as Record<string, unknown>;

    return {
      title: (fm['title'] as string) ?? this.inferTitleFromContent(body),
      module: fm['module'] as string | undefined,
      severity: (fm['severity'] as IGotchaDoc['severity']) ?? 'warning',
      content: body.trim(),
      tags: (fm['tags'] as string[]) ?? [],
    };
  }

  /**
   * Parse a pattern markdown file.
   */
  parsePattern(content: string, filePath: string): IPatternDoc {
    const { data, content: body } = matter(content);
    const fm = data as Record<string, unknown>;

    return {
      name: (fm['name'] as string) ?? this.inferNameFromPath(filePath),
      title: (fm['title'] as string) ?? this.inferTitleFromContent(body),
      content: body.trim(),
      tags: (fm['tags'] as string[]) ?? [],
    };
  }

  /**
   * Infer module path from file path.
   * e.g. 'titan/netron-auth.md' → 'titan/netron-auth'
   */
  private inferModuleFromPath(filePath: string): string {
    return filePath
      .replace(/\.md$/i, '')
      .replace(/\\/g, '/');
  }

  /**
   * Infer a name/identifier from file path.
   * e.g. 'gotchas/bigint-coercion.md' → 'bigint-coercion'
   */
  private inferNameFromPath(filePath: string): string {
    const parts = filePath.replace(/\.md$/i, '').split('/');
    return parts[parts.length - 1] ?? filePath;
  }

  /**
   * Infer title from the first H1/H2 heading in content.
   */
  private inferTitleFromContent(content: string): string {
    const match = content.match(/^#{1,2}\s+(.+)$/m);
    return match?.[1]?.trim() ?? 'Untitled';
  }

  /**
   * Estimate token count (~4 chars per token for mixed code/text).
   */
  estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
