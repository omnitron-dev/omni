import type { LumenNode } from '../ast/types.js';

/** GFM uses null for columns with no declared alignment. */
export function tableAlignments(node: LumenNode): ('left' | 'center' | 'right' | null)[] | undefined {
  const values = node['align'];
  if (!Array.isArray(values)) return undefined;
  return values.map(value => value === 'left' || value === 'center' || value === 'right' ? value : null);
}
