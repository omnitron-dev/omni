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
): Promise<void> {
  const startedAt = Date.now();
  const deadline = startedAt + timeoutMs;
  const { Client } = await import('pg').catch(() => ({ Client: null as unknown as null }));

  const fail = (kind: string, lastError: Error | null): never => {
    const waited = Math.round((Date.now() - startedAt) / 1000);
    const cause = lastError ? ` Last attempt: ${lastError.message}.` : '';
    throw new Error(`Postgres at ${host}:${port} ${kind} (waited ${waited}s, limit ${timeoutMs}ms).${cause}`);
  };

  let lastError: Error | null = null;

  if (!Client) {
    // `pg` unavailable in this build — fall back to a TCP connect probe.
    const net = await import('node:net');
    while (Date.now() < deadline) {
      const ok = await new Promise<boolean>((resolve) => {
        const sock = net.createConnection({ host, port }, () => {
          sock.end();
          resolve(true);
        });
        sock.once('error', (err) => {
          lastError = err as Error;
          resolve(false);
        });
        sock.setTimeout(2_000, () => {
          sock.destroy();
          resolve(false);
        });
      });
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    return fail('was not reachable', lastError);
  }

  while (Date.now() < deadline) {
    const client = new Client({ host, port, user, password, database: 'postgres', connectionTimeoutMillis: 2_000 });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end().catch(() => {});
      return;
    } catch (err) {
      lastError = err as Error;
      await client.end().catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return fail('did not become ready', lastError);
}
