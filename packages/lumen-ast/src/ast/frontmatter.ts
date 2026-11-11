/**
 * Frontmatter Schema, Safe Parser, and Validation via Zod
 */

import matter from 'gray-matter';
import { z } from 'zod';
import type { LumenDiagnostic } from './diagnostics.js';
import { createDiagnostic } from './diagnostics.js';

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024; // 10 MiB
export const MAX_FRONTMATTER_BYTES = 64 * 1024; // 64 KiB

const VALID_ACCESS_LEVELS = new Set(['public', 'internal', 'confidential']);
const FORBIDDEN_PROTO_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const EXECUTABLE_FRONTMATTER_RE = /^\uFEFF?(?:---|~~~)[ \t]*(js|javascript|coffee|coffeescript|toml)\b/i;

const DISABLED_ENGINE = (): never => {
  throw new Error('Executable frontmatter is disabled');
};

const SAFE_MATTER_OPTIONS = {
  engines: {
    js: DISABLED_ENGINE,
    javascript: DISABLED_ENGINE,
    coffee: DISABLED_ENGINE,
    coffeescript: DISABLED_ENGINE,
    toml: DISABLED_ENGINE,
  },
};

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

function stripForbiddenKeys(value: unknown, depth = 0): unknown {
  if (depth > 16 || value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => stripForbiddenKeys(item, depth + 1));
  }
  const clean: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_PROTO_KEYS.has(key)) {
      continue;
    }
    clean[key] = stripForbiddenKeys(val, depth + 1);
  }
  return clean;
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
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { frontmatter: {}, diagnostics };
  }

  const sanitizedData = stripForbiddenKeys(data) as Record<string, unknown>;
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
      createDiagnostic('INVALID_FRONTMATTER', `${path}: ${issue.message}`, 'warning', {
        file: filePath,
        line: 1,
        suggestedFix,
      })
    );
  }

  const fallbackFrontmatter: LumenFrontmatter = { ...(sanitizedData as LumenFrontmatter) };
  if (forcedAccess !== undefined) {
    fallbackFrontmatter.access = forcedAccess;
  }

  return { frontmatter: fallbackFrontmatter, diagnostics };
}

function extractBodyAfterFence(content: string): string {
  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (!withoutBom.startsWith('---') && !withoutBom.startsWith('~~~')) {
    return content;
  }
  const fence = withoutBom.slice(0, 3);
  const closeRegex = new RegExp(`\\r?\\n${fence}[ \\t]*(?:\\r?\\n|$)`);
  const rest = withoutBom.slice(3);
  const match = closeRegex.exec(rest);
  if (match) {
    return rest.slice(match.index + match[0].length);
  }
  const nextHeadingIdx = withoutBom.indexOf('\n#');
  if (nextHeadingIdx !== -1) {
    return withoutBom.slice(nextHeadingIdx + 1);
  }
  return '';
}

export function parseSafeFrontmatter(content: string, filePath?: string): SafeFrontmatterResult {
  const diagnostics: LumenDiagnostic[] = [];
  if (typeof content !== 'string' || content.length === 0) {
    return { frontmatter: {}, content: '', data: {}, diagnostics };
  }

  const totalBytes = Buffer.byteLength(content, 'utf8');
  if (totalBytes > MAX_DOCUMENT_BYTES) {
    diagnostics.push(
      createDiagnostic(
        'DOCUMENT_TOO_LARGE',
        `Document size (${totalBytes} bytes) exceeds maximum limit of ${MAX_DOCUMENT_BYTES} bytes`,
        'error',
        { file: filePath, line: 1 }
      )
    );
    return {
      frontmatter: { access: 'restricted' },
      content: '',
      data: { access: 'restricted' },
      diagnostics,
    };
  }

  if (EXECUTABLE_FRONTMATTER_RE.test(content)) {
    diagnostics.push(
      createDiagnostic(
        'EXECUTABLE_FRONTMATTER_FORBIDDEN',
        'Executable frontmatter engines (js, javascript, coffee, coffeescript, toml) are forbidden',
        'error',
        { file: filePath, line: 1 }
      )
    );
    return {
      frontmatter: { access: 'restricted' },
      content: '',
      data: { access: 'restricted' },
      diagnostics,
    };
  }

  const withoutBom = content.startsWith('\uFEFF') ? content.slice(1) : content;
  if (/^(?:---|~~~)[ \t]*(?:yaml|yml|json)?[ \t]*\r?\n/i.test(withoutBom)) {
    const fence = withoutBom.slice(0, 3);
    const rest = withoutBom.slice(3);
    const closeMatch = new RegExp(`\\r?\\n${fence}[ \\t]*(?:\\r?\\n|$)`).exec(rest);
    const fmCandidate = closeMatch ? rest.slice(0, closeMatch.index) : rest;
    const fmBytes = Buffer.byteLength(fmCandidate, 'utf8');
    if (fmBytes > MAX_FRONTMATTER_BYTES) {
      diagnostics.push(
        createDiagnostic(
          'FRONTMATTER_TOO_LARGE',
          `Frontmatter size (${fmBytes} bytes) exceeds maximum limit of ${MAX_FRONTMATTER_BYTES} bytes`,
          'error',
          { file: filePath, line: 1 }
        )
      );
      return {
        frontmatter: { access: 'restricted' },
        content: closeMatch ? rest.slice(closeMatch.index + closeMatch[0].length) : '',
        data: { access: 'restricted' },
        diagnostics,
      };
    }
  }

  try {
    const parsedMatter = matter(content, SAFE_MATTER_OPTIONS);
    const validated = validateFrontmatter(parsedMatter.data, filePath);
    diagnostics.push(...validated.diagnostics);
    return {
      frontmatter: validated.frontmatter,
      content: parsedMatter.content,
      data: validated.frontmatter as Record<string, unknown>,
      diagnostics,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isExecAttempt = message.includes('Executable frontmatter is disabled');
    diagnostics.push(
      createDiagnostic(
        isExecAttempt ? 'EXECUTABLE_FRONTMATTER_FORBIDDEN' : 'FRONTMATTER_PARSE_ERROR',
        message,
        'error',
        {
          file: filePath,
          line: 1,
        }
      )
    );

    if (isExecAttempt) {
      return {
        frontmatter: { access: 'restricted' },
        content: '',
        data: { access: 'restricted' },
        diagnostics,
      };
    }

    const recoveredBody = extractBodyAfterFence(content);
    // Preserve non-public access hint if present in malformed frontmatter
    const accessHintMatch = content.slice(0, 4096).match(/^\s*access\s*:\s*['"]?([^\s#'"]+)['"]?/m);
    const hintedAccess = accessHintMatch?.[1];
    const recoveredFrontmatter: LumenFrontmatter =
      hintedAccess && hintedAccess !== 'public'
        ? { access: VALID_ACCESS_LEVELS.has(hintedAccess) ? hintedAccess : resolveFailClosedAccess(hintedAccess) }
        : {};

    return {
      frontmatter: recoveredFrontmatter,
      content: recoveredBody,
      data: recoveredFrontmatter as Record<string, unknown>,
      diagnostics,
    };
  }
}
