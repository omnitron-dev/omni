import { Module } from '@omnitron-dev/titan';
import {
  ACCESS_FILTER_SERVICE_TOKEN,
  LIVE_EDIT_SERVICE_TOKEN,
  LUMEN_OPTIONS_TOKEN,
  LUMEN_RPC_CONTROLLER_TOKEN,
  LUMEN_SERVICE_TOKEN,
  MCP_SERVER_TOKEN,
} from './lumen.tokens.js';
import { AccessFilterService } from './access/access-filter.service.js';
import { LiveEditService } from './live/live-edit.service.js';
import { LumenMcpServer } from './mcp/mcp-server.js';
import { LumenRpcService } from './rpc/lumen-rpc.service.js';
import { LumenRpcController } from './rpc/lumen-rpc.controller.js';
import type { ILumenModuleAsyncOptions, ILumenModuleOptions } from './interfaces.js';

const LUMEN_EXPORTS = [
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
];

@Module({
  providers: [
    {
      provide: LUMEN_OPTIONS_TOKEN,
      useValue: {},
    },
    {
      provide: LUMEN_SERVICE_TOKEN,
      useFactory: (opts: ILumenModuleOptions) => new LumenRpcService(opts ?? {}),
      inject: [LUMEN_OPTIONS_TOKEN],
      scope: 'singleton',
    },
    {
      provide: LumenRpcService,
      useFactory: (service: LumenRpcService) => service,
      inject: [LUMEN_SERVICE_TOKEN],
      scope: 'singleton',
    },
    {
      provide: AccessFilterService,
      useFactory: (service: LumenRpcService) => service.getAccessFilterService(),
      inject: [LUMEN_SERVICE_TOKEN],
      scope: 'singleton',
    },
    {
      provide: ACCESS_FILTER_SERVICE_TOKEN,
      useFactory: (accessFilter: AccessFilterService) => accessFilter,
      inject: [AccessFilterService],
      scope: 'singleton',
    },
    {
      provide: LiveEditService,
      useFactory: (service: LumenRpcService) => service.getLiveEditService(),
      inject: [LUMEN_SERVICE_TOKEN],
      scope: 'singleton',
    },
    {
      provide: LIVE_EDIT_SERVICE_TOKEN,
      useFactory: (liveEdit: LiveEditService) => liveEdit,
      inject: [LiveEditService],
      scope: 'singleton',
    },
    {
      provide: LumenMcpServer,
      useFactory: (service: LumenRpcService) => service.getMcpServer(),
      inject: [LUMEN_SERVICE_TOKEN],
      scope: 'singleton',
    },
    {
      provide: MCP_SERVER_TOKEN,
      useFactory: (mcpServer: LumenMcpServer) => mcpServer,
      inject: [LumenMcpServer],
      scope: 'singleton',
    },
    {
      provide: LumenRpcController,
      useFactory: (service: LumenRpcService) => new LumenRpcController(service),
      inject: [LUMEN_SERVICE_TOKEN],
      scope: 'singleton',
    },
    {
      provide: LUMEN_RPC_CONTROLLER_TOKEN,
      useFactory: (controller: LumenRpcController) => controller,
      inject: [LumenRpcController],
      scope: 'singleton',
    },
  ],
  exports: [...LUMEN_EXPORTS],
})
export class LumenModule {
  readonly name = 'LumenModule';

  static forRoot(options: ILumenModuleOptions = {}): any {
    const opts: ILumenModuleOptions = { ...(options ?? {}) };
    const service = new LumenRpcService(opts);
    const accessFilter = service.getAccessFilterService();
    const liveEdit = service.getLiveEditService();
    const mcpServer = service.getMcpServer();
    const controller = new LumenRpcController(service);

    const dynamicModule: Record<string, any> = {
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
        {
          provide: LumenRpcService,
          useValue: service,
        },
        {
          provide: AccessFilterService,
          useValue: accessFilter,
        },
        {
          provide: ACCESS_FILTER_SERVICE_TOKEN,
          useValue: accessFilter,
        },
        {
          provide: LiveEditService,
          useValue: liveEdit,
        },
        {
          provide: LIVE_EDIT_SERVICE_TOKEN,
          useValue: liveEdit,
        },
        {
          provide: LumenMcpServer,
          useValue: mcpServer,
        },
        {
          provide: MCP_SERVER_TOKEN,
          useValue: mcpServer,
        },
        {
          provide: LumenRpcController,
          useValue: controller,
        },
        {
          provide: LUMEN_RPC_CONTROLLER_TOKEN,
          useValue: controller,
        },
      ],
      exports: [...LUMEN_EXPORTS],
    };

    if (opts.global) {
      dynamicModule['global'] = true;
    }

    return dynamicModule;
  }

  static forRootAsync(options: ILumenModuleAsyncOptions): any {
    const dynamicModule: Record<string, any> = {
      module: LumenModule,
      imports: options.imports ?? [],
      providers: [
        {
          provide: LUMEN_OPTIONS_TOKEN,
          useFactory: options.useFactory,
          inject: options.inject || [],
          scope: 'singleton',
        },
        {
          provide: LUMEN_SERVICE_TOKEN,
          useFactory: async (...args: any[]) => {
            const opts = (args[0] as ILumenModuleOptions) ?? {};
            return new LumenRpcService(opts);
          },
          inject: [LUMEN_OPTIONS_TOKEN],
          scope: 'singleton',
        },
        {
          provide: LumenRpcService,
          useFactory: (service: LumenRpcService) => service,
          inject: [LUMEN_SERVICE_TOKEN],
          scope: 'singleton',
        },
        {
          provide: AccessFilterService,
          useFactory: (service: LumenRpcService) => service.getAccessFilterService(),
          inject: [LUMEN_SERVICE_TOKEN],
          scope: 'singleton',
        },
        {
          provide: ACCESS_FILTER_SERVICE_TOKEN,
          useFactory: (accessFilter: AccessFilterService) => accessFilter,
          inject: [AccessFilterService],
          scope: 'singleton',
        },
        {
          provide: LiveEditService,
          useFactory: (service: LumenRpcService) => service.getLiveEditService(),
          inject: [LUMEN_SERVICE_TOKEN],
          scope: 'singleton',
        },
        {
          provide: LIVE_EDIT_SERVICE_TOKEN,
          useFactory: (liveEdit: LiveEditService) => liveEdit,
          inject: [LiveEditService],
          scope: 'singleton',
        },
        {
          provide: LumenMcpServer,
          useFactory: (service: LumenRpcService) => service.getMcpServer(),
          inject: [LUMEN_SERVICE_TOKEN],
          scope: 'singleton',
        },
        {
          provide: MCP_SERVER_TOKEN,
          useFactory: (mcpServer: LumenMcpServer) => mcpServer,
          inject: [LumenMcpServer],
          scope: 'singleton',
        },
        {
          provide: LumenRpcController,
          useFactory: (service: LumenRpcService) => new LumenRpcController(service),
          inject: [LUMEN_SERVICE_TOKEN],
          scope: 'singleton',
        },
        {
          provide: LUMEN_RPC_CONTROLLER_TOKEN,
          useFactory: (controller: LumenRpcController) => controller,
          inject: [LumenRpcController],
          scope: 'singleton',
        },
      ],
      exports: [...LUMEN_EXPORTS],
    };

    if (options.global) {
      dynamicModule['global'] = true;
    }

    return dynamicModule;
  }
}
