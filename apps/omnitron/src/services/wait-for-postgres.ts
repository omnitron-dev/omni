/**
 * Wait until a Postgres accepts connections.
 *
 * Its own module because it has no dependency on `ProjectService` and one test
 * that mattered could not reach it there. `project-service-internals.spec.ts`
 * used to carry a COPY of this function, with a comment saying so, and
 * therefore passed no matter what the real implementation did — including a
 * change to this very message. A test that exercises a duplicate of the code
 * is not a test of the code.
 */

/**
 * Poll until Postgres answers `SELECT 1`, or the deadline passes.
 *
 * Containers are reported "running" by Docker before they accept connections,
 * especially right after a fresh provision: a cold one has to initdb and
 * install extensions first. Callers run migrations immediately after this
 * returns, and a `stack start` aborts entirely if it throws, so the deadline
 * they pass decides whether a slow first boot is a delay or a stack that never
 * comes up.
 *
 * On failure the message carries the last connection error and the time
 * actually spent. Without them it said only that the deadline passed, which is
 * the one thing the operator already knows — "not listening yet", "wrong
 * password" and "database refuses connections" all arrived as the same
 * sentence, naming a duration rather than a cause.
 */
export async function waitForPostgres(
  host: string,
  port: number,
  user: string,
  password: string,
  timeoutMs: number,
  connectionString?: string,
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const { Client } = await import('pg');

  const failure = (kind: string, lastError: Error | null): Error => {
    const waited = Math.round((Date.now() - startedAt) / 1000);
    const last = lastError ? ` Last attempt: ${lastError.message}.` : '';
    return new Error(
      `Postgres at ${host}:${port} ${kind} (waited ${waited}s, limit ${timeoutMs}ms).${last}`,
      lastError ? { cause: lastError } : undefined,
    );
  };

  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const attemptBudget = Math.max(1, Math.min(2_000, deadline - Date.now()));
    const client = new Client({ host, port, user, password, database: 'postgres',
      ...(connectionString ? { connectionString } : {}),
      connectionTimeoutMillis: attemptBudget, query_timeout: attemptBudget });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end().catch(() => {});
      return;
    } catch (err) {
      lastError = err as Error;
      await client.end().catch(() => {});
      // Authentication, authorization and missing databases need an operator, not retries.
      if (['28P01', '28000', '3D000', '42501'].includes((err as { code?: string }).code ?? '')) {
        throw failure('rejected the migration connection', lastError);
      }
      const remaining = deadline - Date.now();
      if (remaining > 0) await new Promise((r) => setTimeout(r, Math.min(500, remaining)));
    }
  }
  throw failure('did not become ready', lastError);
}
