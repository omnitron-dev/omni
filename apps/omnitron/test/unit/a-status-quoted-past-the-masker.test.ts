/**
 * A node's status, read through the masker and quoted into the log.
 *
 * `omnitron status --json` was read four times — before deciding whether to
 * restart a node's daemon, for the apps a node runs, for one app's health,
 * and for the fleet's daemon check — and every read went through the
 * transport's masker, which is right for words and wrong for data: a daemon
 * whose `errors` quoted `"token": …` came back as `"token": [REDACTED]`,
 * which is not JSON, so a running daemon read as one that answered nonsense.
 * The deployer's reads also folded stderr into stdout (`2>&1`), and the
 * answer that could not be parsed was quoted into the log, 120 characters of
 * it.
 *
 * The answer is data, so it travels the data channel (`readFromNode`,
 * `throughDataChannel`), unmasked and unquoted; the reason a node gives for
 * not answering is words, on stderr, and stays masked. So a detail written to
 * the log carries the answer's length and the node's masked words, never the
 * answer.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readNodeHealth } from '../../src/project/node-app-health.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(here, '../../src');

/** Every `.ts` under src, comments stripped crudely but enough for a command literal. */
function sources(): Array<{ file: string; code: string }> {
  const out: Array<{ file: string; code: string }> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.ts')) {
        const code = fs
          .readFileSync(full, 'utf8')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/^\s*\/\/.*$/gm, '');
        out.push({ file: path.relative(SRC, full), code });
      }
    }
  };
  walk(SRC);
  return out;
}

describe('an answer that could not be read', () => {
  it('is described by its length, never quoted', () => {
    const health = readNodeHealth('password=hunter2 and not JSON at all', 'main', 'daos');

    expect(health.online).toBe(false);
    expect(health.detail).not.toContain('hunter2');
    expect(health.detail).toMatch(/not JSON \(36 characters\)/);
  });
});

describe('every read of a node’s status', () => {
  const reads = sources().flatMap(({ file, code }) =>
    [...code.matchAll(/omnitron status --json/g)].map((m) => ({ file, before: code.slice(Math.max(0, m.index! - 400), m.index) })),
  );

  it('is found at all', () => {
    // A scan that matches nothing reports a clean tree.
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  it('goes through the data channel, and none folds its words into its data', () => {
    for (const read of reads) {
      expect(read.before, read.file).toMatch(/readFromNode\(|throughDataChannel\(/);
    }
    for (const { file, code } of sources()) {
      expect(code, file).not.toContain('omnitron status --json 2>&1');
    }
  });
});
