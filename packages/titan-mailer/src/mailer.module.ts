import { Module } from '@omnitron-dev/titan/decorators';
import { createToken, type Token, type DynamicModule } from '@omnitron-dev/titan/nexus';
import { MailerService } from './mailer.service.js';
import type { MailerOptions, MailerAsyncOptions } from './types.js';
export const MAILER_OPTIONS: Token<MailerOptions> = createToken<MailerOptions>('MailerOptions');
export const MAILER: Token<MailerService> = createToken<MailerService>('MailerService');
@Module()
export class MailerModule {
  static forRoot(options: MailerOptions, global = false): DynamicModule {
    return this.forRootAsync({ useFactory: () => options, global });
  }
  static forRootAsync<Args extends unknown[]>(options: MailerAsyncOptions<Args>): DynamicModule {
    return {
      module: MailerModule,
      imports: options.imports,
      global: options.global,
      providers: [
        [MAILER_OPTIONS, { useFactory: options.useFactory, inject: options.inject ?? [] }],
        [
          MailerService,
          {
            useFactory: async (config: MailerOptions) => {
              const service = new MailerService(config);
              try {
                if (config.verifyOnStart) await service.verify();
                return service;
              } catch (error) {
                await service.close();
                throw error;
              }
            },
            inject: [MAILER_OPTIONS],
          },
        ],
        [MAILER, { useToken: MailerService }],
      ],
      exports: [MAILER, MailerService],
    };
  }
}
