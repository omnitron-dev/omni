/**
 * The secrets a node generated, laid over the infrastructure a stack declared.
 *
 * Two halves of one description live in two places, and each is authoritative
 * for its own half:
 *
 *   - the MASTER decides what the stack is — which services, on which ports,
 *     with which databases and which buckets;
 *   - the NODE decides what the secrets are, because `provisionStack` runs
 *     `withGeneratedCredentials` against the node's own vault, and a stack
 *     that declares no password has none for the master to know.
 *
 * The node's generated config was written from the master's half alone, so it
 * carried no `infrastructure` block at all — and `resolveStackAddresses`,
 * which builds `DATABASE_URL`, `REDIS_URL` and the S3 variables, reads that
 * block and nothing else. Its fallback for an absent one is not an error:
 *
 *     const defaultPgPassword =
 *       infra?.postgres?.password ?? getEnv().POSTGRES_PASSWORD ?? 'postgres';
 *
 * Measured on the test node, six apps at once:
 *
 *     Database connection default failed after 5 retries:
 *     password authentication failed for user "postgres" (28P01)
 *
 * — against a container holding a 43-character generated secret. On a laptop
 * the same fallback is CORRECT, which is why nothing caught it until a stack
 * with generated credentials ran somewhere else.
 *
 * Only the secret fields are taken from the node. Ports, database names,
 * bucket lists and everything else stay as the stack declared them: the node
 * carried those out, it did not decide them, and letting its answer win would
 * make a node's drift authoritative over the config.
 */

/** Which field of which service is a secret worth taking from the node. */
const SECRET_FIELDS: Readonly<Record<string, readonly string[]>> = {
  postgres: ['password'],
  redis: ['password'],
  minio: ['accessKey', 'secretKey'],
};

export type Infrastructure = Record<string, unknown> | undefined;

/**
 * Lay the node's secrets over the declared infrastructure.
 *
 * Returns a new object; neither input is modified. A service the node could
 * not answer for is left exactly as declared, and a service the stack does
 * not declare is not invented — an answer about something nobody asked to
 * provision is not evidence that it should exist.
 */
export function overlayCredentials(
  declared: Infrastructure,
  fromNode: Readonly<Record<string, Record<string, unknown>>>,
): Infrastructure {
  if (!declared) return declared;

  const out: Record<string, unknown> = { ...declared };
  for (const [service, fields] of Object.entries(SECRET_FIELDS)) {
    const answer = fromNode[service];
    if (!answer) continue;

    const block = out[service];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;

    const merged: Record<string, unknown> = { ...(block as Record<string, unknown>) };
    let changed = false;
    for (const field of fields) {
      const value = answer[field];
      // An empty string is not a password. `getConnectionInfo` answers with
      // its own defaults when a service has none — `'postgres'`,
      // `'minioadmin'` — and copying those over a declared value would
      // replace a real secret with a well-known one.
      if (typeof value !== 'string' || value.length === 0) continue;
      if (merged[field] === value) continue;
      merged[field] = value;
      changed = true;
    }
    if (changed) out[service] = merged;
  }

  return out;
}
