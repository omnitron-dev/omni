import { describe, expect, it } from 'vitest';
import {
  ACCESS_FILTER_SERVICE_TOKEN,
  AccessFilterService,
  LIVE_EDIT_SERVICE_TOKEN,
  LiveEditService,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LumenMcpServer,
  LumenModule,
  LumenRpcController,
  LumenRpcService,
  MCP_SERVER_TOKEN,
} from './index.js';

describe('@omnitron-dev/titan-lumen', () => {
  it('provides identical tokens and configuration in forRoot and forRootAsync', async () => {
    const syncResult = LumenModule.forRoot({ docsDir: 'docs', kbEnabled: true });
    const asyncResult = LumenModule.forRootAsync({
      useFactory: () => ({ docsDir: 'docs', kbEnabled: true }),
    });

    const syncTokens = syncResult.providers.map((p: any) => p.provide);
    const asyncTokens = asyncResult.providers.map((p: any) => p.provide);

    const expectedTokens = [
      LUMEN_OPTIONS_TOKEN,
      LUMEN_SERVICE_TOKEN,
      LumenRpcService,
      AccessFilterService,
      ACCESS_FILTER_SERVICE_TOKEN,
      LiveEditService,
      LIVE_EDIT_SERVICE_TOKEN,
      LumenMcpServer,
      MCP_SERVER_TOKEN,
      LumenRpcController,
      LUMEN_RPC_CONTROLLER_TOKEN,
    ];

    expect(syncTokens).toEqual(expectedTokens);
    expect(asyncTokens).toEqual(expectedTokens);
    expect(syncResult.exports).toContain(LUMEN_OPTIONS_TOKEN);
    expect(syncResult.exports).toContain(LUMEN_SERVICE_TOKEN);
    expect(syncResult.exports).toContain(LumenRpcService);
    expect(syncResult.exports).toContain(LumenRpcController);
    expect(syncResult.exports).toContain(AccessFilterService);
    expect(syncResult.exports).toContain(LiveEditService);
    expect(syncResult.exports).toContain(LumenMcpServer);
    expect(asyncResult.exports).toEqual(syncResult.exports);
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
