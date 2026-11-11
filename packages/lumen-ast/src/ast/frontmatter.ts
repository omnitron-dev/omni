/**
 * Frontmatter Schema and Validation via Zod
 */

import { z } from 'zod';
import type { LumenDiagnostic } from './diagnostics.js';
import { createDiagnostic } from './diagnostics.js';

export const LumenFrontmatterSchema = z
  .object({
    id: z.string().optional(),
    title: z.string().optional(),
    description: z.string().optional(),
    status: z.enum(['draft', 'canonical', 'deprecated', 'verified']).or(z.string()).optional(),
    version: z.string().optional(),
    tags: z.array(z.string()).optional(),
    relations: z
      .object({
        dependsOn: z.array(z.string()).optional(),
        proves: z.array(z.string()).optional(),
        seeAlso: z.array(z.string()).optional(),
        relatesTo: z.array(z.string()).optional(),
      })
      .optional(),
    access: z.enum(['public', 'internal', 'confidential']).or(z.string()).optional(),
    sidebar_position: z.number().optional(),
    sidebar_label: z.string().optional(),
    paper: z.boolean().optional(),
    authors: z.array(z.string()).optional(),
    abstract: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    hide_table_of_contents: z.boolean().optional(),
    slug: z.string().optional(),
    custom_edit_url: z.string().nullable().optional(),
  })
  .passthrough();

export type LumenFrontmatter = z.infer<typeof LumenFrontmatterSchema>;

export function validateFrontmatter(
  data: unknown,
  filePath?: string
): { frontmatter: LumenFrontmatter; diagnostics: LumenDiagnostic[] } {
  const diagnostics: LumenDiagnostic[] = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { frontmatter: {}, diagnostics };
  }

  const result = LumenFrontmatterSchema.safeParse(data);
  if (result.success) {
    return { frontmatter: result.data, diagnostics };
  }

  for (const issue of result.error.issues) {
    const path = issue.path.join('.');
    let suggestedFix: string | undefined;
    if (issue.path.includes('tags') && issue.code === 'invalid_type') {
      suggestedFix = 'Convert tags to an array of strings';
    } else if (issue.path.includes('sidebar_position') && issue.code === 'invalid_type') {
      suggestedFix = 'Provide a numeric value for sidebar_position';
    }

    diagnostics.push(
      createDiagnostic('INVALID_FRONTMATTER', `${path}: ${issue.message}`, 'warning', {
        file: filePath,
        line: 1,
        suggestedFix,
      })
    );
  }

  return { frontmatter: data as LumenFrontmatter, diagnostics };
}
