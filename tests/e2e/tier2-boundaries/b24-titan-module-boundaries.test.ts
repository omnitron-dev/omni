import { describe, it, expect } from 'vitest';
import { Application } from '@omnitron-dev/titan';
import {
  LumenModule,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_SERVICE_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  ACCESS_FILTER_SERVICE_TOKEN,
  LIVE_EDIT_SERVICE_TOKEN,
  MCP_SERVER_TOKEN,
  LumenRpcService,
  LumenRpcController,
  AccessFilterService,
  LiveEditService,
  LumenMcpServer,
  type ILumenRpcService,
} from '@omnitron-dev/titan-lumen';

describe('Feature 24: Titan LumenModule DI Boundaries', () => {
  it('TC-B24-01: initializes LumenModule via forRoot with empty options object', () => {
    const dynamicModule = LumenModule.forRoot({});

    expect(dynamicModule.module).toBe(LumenModule);
    expect(dynamicModule.providers).toHaveLength(11);
    expect(dynamicModule.exports).toEqual([
      LUMEN_OPTIONS_TOKEN,
      LUMEN_SERVICE_TOKEN,
      LumenRpcService,
      LumenRpcController,
      LUMEN_RPC_CONTROLLER_TOKEN,
      AccessFilterService,
      ACCESS_FILTER_SERVICE_TOKEN,
      LiveEditService,
      LIVE_EDIT_SERVICE_TOKEN,
      LumenMcpServer,
      MCP_SERVER_TOKEN,
    ]);

    const optsProvider = dynamicModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
    expect(optsProvider.useValue).toEqual({});
  });

  it('TC-B24-02: handles undefined or omitted options in forRoot safely', () => {
    const dynamicModule = LumenModule.forRoot(undefined);

    expect(dynamicModule.module).toBe(LumenModule);
    expect(dynamicModule.exports).toContain(LUMEN_SERVICE_TOKEN);
    expect(dynamicModule.exports).toContain(LumenRpcService);
    expect(dynamicModule.exports).toContain(LumenRpcController);

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
    expect(asyncModule.providers).toHaveLength(11);

    const optsProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_OPTIONS_TOKEN);
    const resolvedOpts = await optsProvider.useFactory();
    expect(resolvedOpts.docsDir).toBe('async-docs-dir');
    expect(resolvedOpts.kbEnabled).toBe(true);

    const serviceProvider = asyncModule.providers.find((p: any) => p.provide === LUMEN_SERVICE_TOKEN);
    const resolvedService = await serviceProvider.useFactory(resolvedOpts);
    expect(resolvedService).toBeInstanceOf(LumenRpcService);
    expect(resolvedService.getOptions().docsDir).toBe('async-docs-dir');
  });

  it('TC-B24-06: resolves identical singleton service and configured controller through real Titan Application.create', async () => {
    for (const mode of ['bareModule', 'forRoot', 'forRootAsync'] as const) {
      const options = { docsDir: `audit-${mode}-docs`, accessFilter: { grants: { staff: [] } } };
      const moduleDef =
        mode === 'bareModule'
          ? LumenModule
          : mode === 'forRoot'
            ? LumenModule.forRoot(options)
            : LumenModule.forRootAsync({ useFactory: async () => options });

      const app = await Application.create({
        name: `LumenDiBoundary_${mode}`,
        disableCoreModules: true,
        modules: [moduleDef],
      });
      try {
        const expected = mode === 'bareModule' ? {} : options;
        const tokenSvc = app.resolve<LumenRpcService>(LUMEN_SERVICE_TOKEN);
        const classSvc = app.resolve(LumenRpcService);
        const controller = app.resolve(LumenRpcController);
        expect(tokenSvc).toBe(classSvc);
        expect(tokenSvc.getOptions()).toEqual(expected);
        expect(controller.getOptions()).toEqual(expected);
      } finally {
        await app.stop();
      }
    }
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
