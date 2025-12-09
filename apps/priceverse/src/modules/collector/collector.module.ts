/**
 * Priceverse - Collector Module
 * Handles exchange connections and trade data collection
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { CbrRateService } from './services/cbr-rate.service.js';
import { ExchangeManagerService } from './services/exchange-manager.service.js';
import { CBR_RATE_SERVICE_TOKEN, EXCHANGE_MANAGER_TOKEN } from '../../shared/tokens.js';
import { SUPPORTED_EXCHANGES, type SupportedExchange } from '../../shared/types.js';

@Module({
  providers: [
    // Provide EnabledExchanges from config (defaults to all supported exchanges)
    {
      provide: 'EnabledExchanges',
      useFactory: async (config: ConfigService): Promise<readonly SupportedExchange[]> => {
        const exchangesConfig = config.get('exchanges') as { enabled?: string[] } | undefined;
        if (!exchangesConfig?.enabled) {
          return SUPPORTED_EXCHANGES;
        }
        // Filter to only supported exchanges
        return exchangesConfig.enabled.filter(
          (e): e is SupportedExchange => SUPPORTED_EXCHANGES.includes(e as SupportedExchange)
        );
      },
      inject: [CONFIG_SERVICE_TOKEN],
    },
    { provide: CBR_RATE_SERVICE_TOKEN, useClass: CbrRateService },
    { provide: EXCHANGE_MANAGER_TOKEN, useClass: ExchangeManagerService },
  ],
  exports: [CBR_RATE_SERVICE_TOKEN, EXCHANGE_MANAGER_TOKEN, 'EnabledExchanges'],
})
export class CollectorModule {}
