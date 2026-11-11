import { describe, it, expect } from 'vitest';
import { LumenModule, LUMEN_OPTIONS_TOKEN, LUMEN_SERVICE_TOKEN, LumenRpcService } from '@omnitron-dev/titan-lumen';

describe('Feature 24: Titan LumenModule DI', () => {
  it('TC-F24-01: initializes LumenModule via static forRoot with configuration options', () => {
    const dynamicModule = LumenModule.forRoot({
      docsDir: 'docs',
      mcpEnabled: true,
    });

    expect(dynamicModule.module).toBe(LumenModule);
    expect(dynamicModule.providers).toBeDefined();
    expect(dynamicModule.exports).toContain(LUMEN_SERVICE_TOKEN);
  });

  it('TC-F24-02: initializes LumenModule via forRootAsync factory provider', async () => {
    const asyncModule = LumenModule.forRootAsync({
      useFactory: () => ({
        docsDir: 'custom-docs',
        kbEnabled: true,
      }),
    });

    expect(asyncModule.module).toBe(LumenModule);
    expect(asyncModule.providers).toBeDefined();
    expect(asyncModule.exports).toContain(LUMEN_SERVICE_TOKEN);
  });

  it('TC-F24-03: defines standard injection tokens LUMEN_OPTIONS_TOKEN and LUMEN_SERVICE_TOKEN', () => {
    expect(LUMEN_OPTIONS_TOKEN).toBeDefined();
    expect(LUMEN_SERVICE_TOKEN).toBeDefined();
    expect(['symbol', 'string']).toContain(typeof LUMEN_OPTIONS_TOKEN);
    expect(['symbol', 'string']).toContain(typeof LUMEN_SERVICE_TOKEN);
  });

  it('TC-F24-04: binds configured options to the resolved LumenRpcService instance', () => {
    const dynamicModule = LumenModule.forRoot({
      docsDir: 'research/papers',
      mcpEnabled: true,
    });

    const serviceProvider = dynamicModule.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);
    expect(serviceProvider).toBeDefined();
    expect(serviceProvider.useValue).toBeInstanceOf(LumenRpcService);

    const serviceInstance = serviceProvider.useValue as LumenRpcService;
    expect(serviceInstance.getOptions().docsDir).toBe('research/papers');
    expect(serviceInstance.getOptions().mcpEnabled).toBe(true);
  });

  it('TC-F24-05: provides LumenRpcService singleton in module static definition', () => {
    const dynamicModule = LumenModule.forRoot({});
    const serviceToken = dynamicModule.exports.find((t: any) => t === LUMEN_SERVICE_TOKEN);
    expect(serviceToken).toBe(LUMEN_SERVICE_TOKEN);
  });
});
