import { describe, expect, it } from 'vitest';
import { LUMEN_OPTIONS_TOKEN, LUMEN_SERVICE_TOKEN, LumenModule, LumenRpcService } from './index.js';

describe('@omnitron-dev/titan-lumen', () => {
  it('provides identical tokens and configuration in forRoot and forRootAsync', async () => {
    const syncResult = LumenModule.forRoot({ docsDir: 'docs', kbEnabled: true });
    const asyncResult = LumenModule.forRootAsync({
      useFactory: () => ({ docsDir: 'docs', kbEnabled: true }),
    });

    const syncTokens = syncResult.providers.map((p: any) => p.provide);
    const asyncTokens = asyncResult.providers.map((p: any) => p.provide);

    expect(syncTokens).toEqual([LUMEN_OPTIONS_TOKEN, LUMEN_SERVICE_TOKEN]);
    expect(asyncTokens).toEqual([LUMEN_OPTIONS_TOKEN, LUMEN_SERVICE_TOKEN]);
    expect(syncResult.exports).toEqual([LUMEN_SERVICE_TOKEN]);
    expect(asyncResult.exports).toEqual([LUMEN_SERVICE_TOKEN]);
  });

  it('implements ILumenRpcService methods and exposes options', async () => {
    const service = new LumenRpcService({ docsDir: 'custom-docs', mcpEnabled: true });
    expect(service.getOptions()).toEqual({ docsDir: 'custom-docs', mcpEnabled: true });

    const searchResults = await service.search('query string');
    expect(searchResults).toEqual([]);

    const playgroundResult = await service.executePlayground('const a = 1;');
    expect(playgroundResult).toEqual({ result: null, code: 'const a = 1;' });

    const doc = await service.getDocument('/docs/intro');
    expect(doc).toBeNull();

    const contract = await service.getSymbolContract('MathTheoremBlock');
    expect(contract).toBeNull();
  });
});
