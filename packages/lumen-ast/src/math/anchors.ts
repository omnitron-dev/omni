/**
 * Deep-linking Anchor Generator for Mathematical Environments
 */

import type { MathEnvType, MathEnvironmentAttributes } from './environments.js';

export function generateMathAnchor(
  envType: MathEnvType,
  attrs: MathEnvironmentAttributes,
  index: number,
  existingAnchors: Set<string>
): string {
  if (attrs.id) {
    existingAnchors.add(attrs.id);
    return attrs.id;
  }

  const titlePart = attrs.title
    ? attrs.title
        .toLowerCase()
        .replace(/<[^>]+>/g, '')
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/(^-|-$)/g, '')
    : String(index);

  const base = `${envType}-${titlePart || index}`;
  let candidate = base;
  let counter = 1;
  while (existingAnchors.has(candidate)) {
    candidate = `${base}-${++counter}`;
  }
  existingAnchors.add(candidate);
  return candidate;
}
