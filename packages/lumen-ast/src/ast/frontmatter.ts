/**
 * Frontmatter Schema, Safe Parser, and Validation via Zod
 */

import { parseDocument as parseYamlDocument } from 'yaml';
import { z } from 'zod';
import type { LumenDiagnostic } from './diagnostics.js';
import { createDiagnostic } from './diagnostics.js';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_FRONTMATTER_BYTES = 64 * 1024; // 64 KiB

const VALID_ACCESS_LEVELS = new Set(['public', 'internal', 'confidential']);
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
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

export interface SafeFrontmatterResult {
  frontmatter: LumenFrontmatter;
  content: string;
  data: Record<string, unknown>;
  diagnostics: LumenDiagnostic[];
}

function stripForbiddenKeys(value: unknown): unknown {
  const ancestors = new WeakSet<object>();
  let remaining = 10_000;
  const visit = (item: unknown, depth: number): unknown => {
    if (--remaining < 0 || depth > 16) throw new Error('Frontmatter structure exceeds its limits');
    if (item === null || typeof item !== 'object') return item;
    if (ancestors.has(item)) throw new Error('Cyclic frontmatter is not supported');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) return item.map((child) => visit(child, depth + 1));
      const clean: Record<string, unknown> = {};
      for (const [key, child] of Object.entries(item)) {
        if (!FORBIDDEN_PROTO_KEYS.has(key)) clean[key] = visit(child, depth + 1);
      }
      return clean;
    } finally {
      ancestors.delete(item);
    }
  };
  return visit(value, 0);
}

function resolveFailClosedAccess(rawAccess: unknown): string {
  if (typeof rawAccess === 'string') {
    const trimmed = rawAccess.trim();
    if (trimmed.length > 0 && trimmed.toLowerCase() !== 'public') {
      return trimmed;
    }
    return 'restricted';
  }
  if (rawAccess === null || rawAccess === undefined || typeof rawAccess === 'boolean') {
    return 'restricted';
  }
  if (typeof rawAccess === 'number') {
    return Number.isFinite(rawAccess) ? String(rawAccess) : 'restricted';
  }
  return 'restricted';
}

export function validateFrontmatter(
  data: unknown,
  filePath?: string
): { frontmatter: LumenFrontmatter; diagnostics: LumenDiagnostic[] } {
  const diagnostics: LumenDiagnostic[] = [];
  let sanitizedData: Record<string, unknown>;
  try {
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Frontmatter must be a mapping');
    sanitizedData = stripForbiddenKeys(data) as Record<string, unknown>;
  } catch (error) {
    return {
      frontmatter: { access: 'restricted' },
      diagnostics: [
        createDiagnostic('INVALID_FRONTMATTER', error instanceof Error ? error.message : 'Invalid metadata', 'error', {
          file: filePath,
          line: 1,
        }),
      ],
    };
  }
  const hasExplicitAccess =
    Object.prototype.hasOwnProperty.call(sanitizedData, 'access') && sanitizedData['access'] !== undefined;
  const rawAccess = sanitizedData['access'];
  let forcedAccess: string | undefined;

  if (hasExplicitAccess) {
    if (typeof rawAccess !== 'string' || !VALID_ACCESS_LEVELS.has(rawAccess)) {
      forcedAccess = resolveFailClosedAccess(rawAccess);
      diagnostics.push(
        createDiagnostic(
          'FRONTMATTER_INVALID_ACCESS',
          `access: Invalid access policy "${String(rawAccess)}"; expected 'public', 'internal', or 'confidential'`,
          'error',
          {
            file: filePath,
            line: 1,
            suggestedFix: "Set access to 'public', 'internal', or 'confidential'",
          }
        )
      );
    }
  }

  const result = LumenFrontmatterSchema.safeParse(sanitizedData);
  if (result.success) {
    const validatedFrontmatter: LumenFrontmatter = { ...result.data };
    if (forcedAccess !== undefined) {
      validatedFrontmatter.access = forcedAccess;
    }
    return { frontmatter: validatedFrontmatter, diagnostics };
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
      createDiagnostic('INVALID_FRONTMATTER', `${path}: ${issue.message}`, 'error', {
        file: filePath,
        line: 1,
        suggestedFix,
      })
    );
  }

  return { frontmatter: { access: 'restricted' }, diagnostics };
}

/** Parse data-only YAML/JSON identically in browsers, SSG, RPC and migration. */
export function parseSafeFrontmatter(content: string, filePath?: string): SafeFrontmatterResult {
  const fail = (code: string, message: string, body = ''): SafeFrontmatterResult => ({
    frontmatter: { access: 'restricted' },
    data: { access: 'restricted' },
    content: body,
    diagnostics: [createDiagnostic(code, message, 'error', { file: filePath, line: 1 })],
  });
  if (typeof content !== 'string' || !content) return { frontmatter: {}, data: {}, content: '', diagnostics: [] };
  const bytes = (value: string): number => new TextEncoder().encode(value).byteLength;
  if (content.length > MAX_DOCUMENT_BYTES || bytes(content) > MAX_DOCUMENT_BYTES)
    return fail('DOCUMENT_TOO_LARGE', `Document exceeds ${MAX_DOCUMENT_BYTES} bytes`);

  const source = content.replace(/^\uFEFF/, '');
  const opening = /^(---|~~~)([^\r\n]*)\r?\n/.exec(source);
  if (!opening) return { frontmatter: {}, data: {}, content: source, diagnostics: [] };
  const engine = opening[2]!.trim().toLowerCase();
  if (!['', 'yaml', 'yml', 'json'].includes(engine))
    return fail('EXECUTABLE_FRONTMATTER_FORBIDDEN', 'Only data-only YAML and JSON frontmatter are supported');
  const rest = source.slice(opening[0].length);
  const closing = new RegExp(`^${opening[1]}[ \t]*(?:\\r?\\n|$)`, 'm').exec(rest);
  const metadata = closing ? rest.slice(0, closing.index) : rest;
  const body = closing ? rest.slice(closing.index + closing[0].length) : '';
  if (metadata.length > MAX_FRONTMATTER_BYTES || bytes(metadata) > MAX_FRONTMATTER_BYTES)
    return fail('FRONTMATTER_TOO_LARGE', `Frontmatter exceeds ${MAX_FRONTMATTER_BYTES} bytes`, body);
  if (!closing) return fail('FRONTMATTER_PARSE_ERROR', 'Unclosed frontmatter');

  try {
    let data: unknown = {};
    if (metadata.trim()) {
      if (engine === 'json') data = JSON.parse(metadata);
      else {
        const document = parseYamlDocument(metadata, { schema: 'core', uniqueKeys: true });
        const issue = document.errors[0] ?? document.warnings[0];
        if (issue) throw new Error(issue.message);
        data = document.toJS({ maxAliasCount: 100 });
      }
    }
    const validated = validateFrontmatter(data, filePath);
    return { ...validated, content: body, data: validated.frontmatter };
  } catch (error) {
    return fail('FRONTMATTER_PARSE_ERROR', error instanceof Error ? error.message : 'Invalid frontmatter', body);
  }
}
