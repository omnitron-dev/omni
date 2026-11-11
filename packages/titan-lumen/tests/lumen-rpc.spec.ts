import { describe, it, expect } from 'vitest';
import { LumenRpcService } from '../src/rpc/lumen-rpc.service.js';
import { LumenRpcController } from '../src/rpc/lumen-rpc.controller.js';

describe('LumenRpcService and Controller', () => {
  it('searches corpus and handles empty query and limit', async () => {
    const service = new LumenRpcService();
    expect(await service.search('')).toEqual([]);
    expect(await service.search('   \n\t ')).toEqual([]);
    expect(await service.search('intro', { limit: 0 })).toEqual([]);

    const results = await service.search('spectral');
    expect(Array.isArray(results)).toBe(true);
  });

  it('executes playground safely with VM and captures syntax errors', async () => {
    const service = new LumenRpcService();

    const validResult = await service.executePlayground('const a = 2 * 3; return a;');
    expect(validResult.code).toContain('2 * 3');
    expect(validResult.result).toBe(6);

    const syntaxResult = await service.executePlayground('const = ; invalid;');
    expect(syntaxResult.code).toContain('const = ;');
    expect(syntaxResult.result).toBeNull();
    expect(syntaxResult.error).toBeDefined();
  });

  it('strictly guards getDocument against path traversal', async () => {
    const service = new LumenRpcService();
    const malicious = ['../../../etc/passwd', '..\\..\\windows\\system32', '/var/run/secrets', './../../package.json'];

    for (const p of malicious) {
      expect(await service.getDocument(p)).toBeNull();
    }

    const doc = await service.getDocument('docs/intro.pdx');
    expect(typeof doc === 'string' || doc === null).toBe(true);
  });

  it('retrieves symbol contracts for known symbols and null for unknown', async () => {
    const service = new LumenRpcService();

    const known = await service.getSymbolContract('CorpusGraph');
    expect(known).toBeDefined();
    expect(known?.name).toBe('CorpusGraph');

    const ghost = await service.getSymbolContract('NonExistentQuantumOperator');
    expect(ghost).toBeNull();
  });

  it('delegates controller calls to service', async () => {
    const service = new LumenRpcService();
    const controller = new LumenRpcController(service);

    const res = await controller.search('intro');
    expect(Array.isArray(res)).toBe(true);
    expect('getOptions' in controller).toBe(false);
  });
});
