import { Module } from '@omnitron-dev/titan';
import type { DynamicModule } from '@omnitron-dev/titan/nexus';
import { LUMEN_OPTIONS_TOKEN } from './constants.js';
import { AccessFilterService } from './access/access-filter.service.js';
import { LiveEditService } from './live/live-edit.service.js';
import { LumenService } from './lumen.service.js';
import type { LumenModuleAsyncOptions, LumenModuleOptions } from './types.js';

// One lazy dependency graph for bare, synchronous and asynchronous modules.
const providers = [
  {
    provide: AccessFilterService,
    useFactory: (options: LumenModuleOptions) => new AccessFilterService(options.accessFilter),
    inject: [LUMEN_OPTIONS_TOKEN],
  },
  {
    provide: LiveEditService,
    useFactory: (options: LumenModuleOptions) => new LiveEditService(options.liveEdit),
    inject: [LUMEN_OPTIONS_TOKEN],
  },
  {
    provide: LumenService,
    useFactory: (options: LumenModuleOptions, access: AccessFilterService, live: LiveEditService) =>
      new LumenService(options, access, live),
    inject: [LUMEN_OPTIONS_TOKEN, AccessFilterService, LiveEditService],
  },
] satisfies NonNullable<DynamicModule['providers']>;
const exports = [LUMEN_OPTIONS_TOKEN, LumenService, AccessFilterService, LiveEditService];

@Module({ providers: [{ provide: LUMEN_OPTIONS_TOKEN, useValue: {} }, ...providers], exports })
export class LumenModule {
  readonly name = 'LumenModule';

  static forRoot(options: LumenModuleOptions = {}): DynamicModule {
    return {
      module: LumenModule,
      providers: [{ provide: LUMEN_OPTIONS_TOKEN, useValue: { ...options } }, ...providers],
      exports,
      global: options.global,
    };
  }

  static forRootAsync(options: LumenModuleAsyncOptions): DynamicModule {
    return {
      module: LumenModule,
      imports: options.imports,
      providers: [{ provide: LUMEN_OPTIONS_TOKEN, useFactory: options.useFactory, inject: options.inject ?? [] }, ...providers],
      exports,
      global: options.global,
    };
  }
}
