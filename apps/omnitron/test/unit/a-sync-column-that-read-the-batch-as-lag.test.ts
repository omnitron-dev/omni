/**
 * A Sync column that read the batch as lag.
 *
 * `omnitron stack status` printed `synced` or `N pending`. On a node keeping
 * up, N is the batch waiting for the next pull — measured 275–515 across six
 * samples ten seconds apart, `lastSyncAt` moving every ~15 s — so the column
 * nearly always said «pending», and a node that had stopped being pulled
 * printed exactly the same. It now reads the console's reading
 * (`sync-reading.ts`), which tells «in sync · N since the last pull» from
 * «behind · N waiting, last pull 300 s ago».
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { syncFinding, syncWords, inSync } from '../../src/shared/sync-reading.js';

const here = path.dirname(fileURLToPath(import.meta.url));

describe('the Sync column', () => {
  it('reads sync the way the console does', () => {
    const source = fs.readFileSync(path.join(here, '../../src/commands/stack.ts'), 'utf8');
    expect(source).toMatch(/syncWords\(\s*finding\s*\)/);
    expect(source).not.toMatch(/\$\{n\.syncStatus\.pendingItems\} pending/);
  });

  it('tells a node keeping up from one falling behind', () => {
    const now = Date.UTC(2026, 8, 23, 13, 30, 0);
    const keeping = syncFinding({ pendingItems: 258, lastSyncAt: now - 12_000 }, now);
    const behind = syncFinding({ pendingItems: 258, lastSyncAt: now - 300_000 }, now);
    expect(inSync(keeping)).toBe(true);
    expect(inSync(behind)).toBe(false);
    expect(syncWords(behind)).toMatch(/behind · 258 waiting, last pull 300 s ago/);
  });
});
