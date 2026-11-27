/** Stable field order for in-memory identities and the persisted series digest. */
export function orderedLabels(labels: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(labels).sort().map(key => [key, labels[key]!]));
}
