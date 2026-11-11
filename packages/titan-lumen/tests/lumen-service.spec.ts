import { afterEach, describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LumenService } from '../src/lumen.service.js';
import { asUser } from './netron-fixture.js';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function corpus() { const root = mkdtempSync(join(tmpdir(), 'lumen-documents-')); roots.push(root); return root; }

describe('LumenService', () => {
  it('uses actual documents and does not synthesize missing corpus data or symbols', async () => {
    const docsDir = corpus();
    const service = new LumenService({ docsDir });
    expect(await service.search('')).toEqual([]);
    expect(await service.search('spectral')).toEqual([]);
    expect(await service.getTheoremGraph()).toEqual({ nodes: [], edges: [] });
    expect(await service.getDocument('docs/intro.pdx')).toBeNull();
    expect(await service.getSymbolContract('CorpusGraph')).toBeNull();
    writeFileSync(join(docsDir, 'intro.pdx'), '# Actual Guide\nActual corpus text.');
    expect(await service.search('corpus')).toMatchObject([{ title: 'Actual Guide', path: 'intro.pdx' }]);
    expect(await service.search('corpus', { limit: 0 })).toEqual([]);
    const missing = new LumenService({ docsDir: join(docsDir, 'missing') });
    await expect(missing.search('anything')).rejects.toThrow('configured documentation corpus');
    await expect(missing.getTheoremGraph()).rejects.toThrow('configured documentation corpus');
  });

  it('runs authorized playground requests through Netron and preserves compiler failures', async () => {
    const client = await asUser(new LumenService(), 'admin');
    expect(await client.executePlayground('const a = 2 * 3; return a;')).toMatchObject({ result: 6 });
    expect(await client.executePlayground('const = ; invalid;')).toMatchObject({ result: null, error: expect.any(String) });
  });

  it('rejects traversal, absolute paths and unsupported source types', async () => {
    const service = new LumenService({ docsDir: corpus() });
    for (const path of ['../../../etc/passwd', '..\\..\\windows\\system32', '/var/run/secrets', './../../package.json', '%252e%252e/private.md']) {
      expect(await service.getDocument(path)).toBeNull();
    }
  });
});
