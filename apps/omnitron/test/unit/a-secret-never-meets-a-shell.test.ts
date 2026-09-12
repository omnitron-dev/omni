/**
 * A MinIO secret was a fragment of a shell command.
 *
 * `mc alias set _bk http://localhost:9000 ${ak} ${sk}` put the credentials
 * into a string that `/bin/sh -c` then parsed — twice, because the outer
 * command wrapped it as `docker exec <c> sh -c '<inner>'`. A secret
 * containing a single quote ends the inner quoting and the remainder runs as
 * shell, on the HOST, as the daemon user.
 *
 * Nothing validates what a MinIO secret may contain, and a generated one is
 * exactly the kind of string that eventually holds a quote. The fix is not
 * better quoting: the credential is passed through `execFile`'s argv as an
 * environment variable, so it never meets a shell parser at all, and the
 * script reads `"$MC_AK"` — expanded by the inner shell, not re-parsed.
 *
 * Asserted over the source because the property is about what is CONSTRUCTED,
 * not about what a stubbed `execFile` was handed. Comments are stripped
 * first: this file's own note above names the very pattern it forbids.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../../src/services/backup.service.ts', import.meta.url), 'utf8');
const code = raw
  .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(Math.max(0, m.length - p1.length)));

describe('the MinIO credentials', () => {
  it('are never interpolated into a command string', () => {
    // `${ak}` / `${sk}` anywhere EXCEPT the `MC_AK=` / `MC_SK=` argv element.
    // That one is a template literal too, but it is an argument in an argv
    // array — it never reaches a parser. The distinction is the whole fix, so
    // the assertion has to make it rather than ban the syntax.
    const offenders = [...code.matchAll(/\$\{\s*(ak|sk)\s*\}/g)]
      .filter((m) => !/MC_(AK|SK)=$/.test(code.slice(Math.max(0, m.index! - 8), m.index!)))
      .map((m) => code.slice(0, m.index!).split('\n').length);

    expect(offenders, 'a secret in a shell string is a shell fragment').toEqual([]);
  });

  it('reach the container through the environment instead', () => {
    expect(code).toContain("'-e', `MC_AK=${ak}`");
    expect(code).toContain("'-e', `MC_SK=${sk}`");
  });

  it('are read back quoted, so a space or a star cannot re-split them', () => {
    expect(code).toContain('"$MC_AK"');
    expect(code).toContain('"$MC_SK"');
    expect(code, 'unquoted would re-split on whitespace').not.toContain('$MC_AK ');
  });

  it('travel by argv, not through /bin/sh', () => {
    const at = code.indexOf('private async execInMinio');
    expect(at).toBeGreaterThan(0);
    const fn = code.slice(at, code.indexOf('\n  private ', at + 10));

    expect(fn).toContain("execFile('docker', args");
    expect(fn, 'the whole point is that no shell parses these').not.toContain('/bin/sh');
  });

  it('still runs the mirror it always ran', () => {
    // The fix must not quietly drop a step: both directions still mirror.
    expect(code).toContain('mc mirror --overwrite --quiet /tmp/_bk_storage _bk/storage');
    expect(code).toContain('mc mirror --overwrite --quiet _bk/storage /tmp/_bk_storage');
  });
});

describe('the paths that are still shell', () => {
  it('only interpolate values this service generates', () => {
    // `stage` and `filepath` are `path.join(backupDir, <literal>-<uuid>)`, so
    // they are quoted AND unsurprising. Pinned so a future edit that lets a
    // caller name one of them has to notice this line.
    expect(code).toMatch(/const stage = path\.join\(this\.backupDir, `\.storage-(restore|stage)-\$\{randomUUID\(\)/);
    expect(code).toContain('rm -rf "${stage}"');
  });
});
