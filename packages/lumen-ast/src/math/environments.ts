/**
 * 10 Formal Mathematical Environments Data Models and Attributes
 */

export const FORMAL_MATH_ENV_TYPES = [
  'axiom',
  'definition',
  'theorem',
  'lemma',
  'proposition',
  'corollary',
  'proof',
  'remark',
  'example',
  'hypothesis',
] as const;

export type MathEnvType = (typeof FORMAL_MATH_ENV_TYPES)[number];

export const MATH_STATUS_VALUES = ['verified', 'draft', 'axiom', 'deprecated'] as const;

export type MathStatus = (typeof MATH_STATUS_VALUES)[number] | string;

export interface MathEnvironmentAttributes {
  id?: string;
  title?: string;
  status?: MathStatus;
  dependsOn?: string[];
  proves?: string[];
  number?: string;
  unnumbered?: boolean;
  of?: string;
  for?: string;
  [key: string]: unknown;
}

export function isFormalMathEnv(env: string): env is MathEnvType {
  return (FORMAL_MATH_ENV_TYPES as readonly string[]).includes(env);
}

export function parseDirectiveAttributes(rawAttrs: Record<string, unknown>): MathEnvironmentAttributes {
  const result: MathEnvironmentAttributes = {};

  const rawId = rawAttrs['id'];
  if (typeof rawId === 'string' && rawId.trim()) {
    result.id = rawId.trim();
  }
  const rawTitle = rawAttrs['title'];
  if (typeof rawTitle === 'string' && rawTitle.trim()) {
    result.title = rawTitle.trim();
  }
  const rawStatus = rawAttrs['status'];
  if (typeof rawStatus === 'string' && rawStatus.trim()) {
    result.status = rawStatus.trim() as MathStatus;
  }
  const rawNum = rawAttrs['number'];
  if (rawNum !== undefined && rawNum !== null && rawNum !== '') {
    result.number = String(rawNum).trim();
  }

  const rawUnnumbered = rawAttrs['unnumbered'];
  if (rawUnnumbered === true || rawUnnumbered === 'true' || rawUnnumbered === '') {
    result.unnumbered = true;
  }

  const proofTarget = rawAttrs['of'] ?? rawAttrs['for'];
  if (typeof proofTarget === 'string' && proofTarget.trim()) {
    result.of = proofTarget.trim();
    result.for = proofTarget.trim();
  }

  for (const arrayProp of ['dependsOn', 'proves'] as const) {
    const val = rawAttrs[arrayProp];
    if (Array.isArray(val)) {
      result[arrayProp] = val
        .map(String)
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (typeof val === 'string') {
      const trimmed = val.trim();
      if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
        try {
          const parsed = JSON.parse(trimmed);
          if (Array.isArray(parsed)) {
            result[arrayProp] = parsed
              .map(String)
              .map((s) => s.trim())
              .filter(Boolean);
            continue;
          }
        } catch {
          // fallback to comma split
        }
      }
      result[arrayProp] = trimmed
        .replace(/^\[|\]$/g, '')
        .split(',')
        .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    }
  }

  return result;
}
