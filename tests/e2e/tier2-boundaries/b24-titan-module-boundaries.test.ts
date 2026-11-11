import { describe, it, expect } from 'vitest';
import {
  LumenModule,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LumenRpcService,
  type ILumenRpcService,
} from '@omnitron-dev/titan-lumen';

describe('Feature 24: Titan LumenModule DI Boundaries', () => {
  it('TC-B24-01: initializes LumenModule via forRoot with empty options object', () => {
    const dynamicModule = LumenModule.forRoot({});

    expect(dynamicModule.module).toBe(LumenModule);
    expect(dynamicModule.providers).toHaveLength(2);
    expect(dynamicModule.exports).toEqual([LUMEN_SERVICE_TOKEN]);

    const optsProvider = dynamicModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
    expect(optsProvider.useValue).toEqual({});
  });

  it('TC-B24-02: handles undefined or omitted options in forRoot safely', () => {
    const dynamicModule = LumenModule.forRoot(undefined);

    expect(dynamicModule.module).toBe(LumenModule);
    expect(dynamicModule.exports).toContain(LUMEN_SERVICE_TOKEN);

    const serviceProvider = dynamicModule.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);
    expect(serviceProvider.useValue).toBeInstanceOf(LumenRpcService);
  });

  it('TC-B24-03: initializes LumenModule via forRootAsync with async factory provider', async () => {
    const asyncModule = LumenModule.forRootAsync({
      useFactory: async () => ({
        docsDir: 'async-docs-dir',
        mcpEnabled: false,
        kbEnabled: true,
      }),
    });

    expect(asyncModule.module).toBe(LumenModule);
    expect(asyncModule.providers).toHaveLength(2);

    const optsProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
    const resolvedOpts = await optsProvider.useFactory();
    expect(resolvedOpts.docsDir).toBe('async-docs-dir');
    expect(resolvedOpts.kbEnabled).toBe(true);

    const serviceProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);
    const resolvedService = await serviceProvider.useFactory(resolvedOpts);
    expect(resolvedService).toBeInstanceOf(LumenRpcService);
    expect(resolvedService.getOptions().docsDir).toBe('async-docs-dir');
  });

  it('TC-B24-04: ensures independent option binding across multiple distinct module instances', () => {
    const moduleA = LumenModule.forRoot({ docsDir: 'docs-a' });
    const moduleB = LumenModule.forRoot({ docsDir: 'docs-b' });

    const serviceA = moduleA.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN).useValue as LumenRpcService;
    const serviceB = moduleB.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN).useValue as LumenRpcService;

    expect(serviceA.getOptions().docsDir).toBe('docs-a');
    expect(serviceB.getOptions().docsDir).toBe('docs-b');
  });

  it('TC-B24-05: verifies resolved service satisfies complete ILumenRpcService method signatures', () => {
    const service: ILumenRpcService = new LumenRpcService();

    expect(typeof service.search).toBe('function');
    expect(typeof service.executePlayground).toBe('function');
    expect(typeof service.getDocument).toBe('function');
    expect(typeof service.getSymbolContract).toBe('function');
    expect(typeof (service as LumenRpcService).getOptions).toBe('function');
  });
});
