/**
 * Proof Linking and Q.E.D. Tombstone Handling
 */

export const QED_SYMBOL = '∎';

export interface ProofLinkInfo {
  targetId?: string;
  hasTarget: boolean;
  qedSymbol: string;
}

export function resolveProofLink(attrs: { of?: string; for?: string }): ProofLinkInfo {
  const targetId = attrs.of ?? attrs.for;
  return {
    targetId: targetId?.trim(),
    hasTarget: Boolean(targetId && targetId.trim().length > 0),
    qedSymbol: QED_SYMBOL,
  };
}
