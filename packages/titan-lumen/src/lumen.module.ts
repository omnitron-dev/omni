import { Module } from '@omnitron-dev/titan';
import { LUMEN_OPTIONS_TOKEN, LUMEN_SERVICE_TOKEN } from './lumen.tokens.js';
import { LumenRpcService } from './rpc/lumen-rpc.service.js';
import { LumenRpcController } from './rpc/lumen-rpc.controller.js';
import type { ILumenModuleAsyncOptions, ILumenModuleOptions } from './interfaces.js';

@Module({
  providers: [
    {
      provide: LUMEN_SERVICE_TOKEN,
      useClass: LumenRpcService,
      scope: 'singleton',
    },
    LumenRpcService,
    LumenRpcController,
  ],
  exports: [LUMEN_SERVICE_TOKEN, LumenRpcService, LumenRpcController],
})
export class LumenModule {
  static forRoot(options: ILumenModuleOptions = {}): any {
    const opts = options ?? {};
    const service = new LumenRpcService(opts);
    return {
      module: LumenModule,
      providers: [
        {
          provide: LUMEN_OPTIONS_TOKEN,
          useValue: opts,
        },
        {
          provide: LUMEN_SERVICE_TOKEN,
          useValue: service,
        },
      ],
      exports: [LUMEN_SERVICE_TOKEN],
    };
  }

  static forRootAsync(options: ILumenModuleAsyncOptions): any {
    return {
      module: LumenModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: LUMEN_OPTIONS_TOKEN,
          useFactory: options.useFactory,
          inject: options.inject || [],
        },
        {
          provide: LUMEN_SERVICE_TOKEN,
          useFactory: async (...args: any[]) => {
            const opts = (args[0] as ILumenModuleOptions) ?? {};
            const service = new LumenRpcService(opts);
            return service;
          },
          inject: [LUMEN_OPTIONS_TOKEN],
        },
      ],
      exports: [LUMEN_SERVICE_TOKEN],
    };
  }
}
