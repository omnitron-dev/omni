/**
 * Priceverse 2.0 - Collector Module
 * Handles exchange connections and trade data collection
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { CONFIG_SERVICE_TOKEN, type ConfigService } from '@omnitron-dev/titan/module/config';
import { CbrRateService } from './services/cbr-rate.service.js';
import { ExchangeManagerService } from './services/exchange-manager.service.js';
import { CBR_RATE_SERVICE_TOKEN, EXCHANGE_MANAGER_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    // Provide EnabledExchanges from config
    {
      provide: 'EnabledExchanges',
      useFactory: async (config: ConfigService) => {
        const exchangesConfig = config.get('exchanges') as { enabled?: string[] } | undefined;
        return exchangesConfig?.enabled ?? ['binance', 'kraken', 'coinbase', 'okx', 'bybit', 'kucoin'];
      },
      inject: [CONFIG_SERVICE_TOKEN],
    },
    { provide: CBR_RATE_SERVICE_TOKEN, useClass: CbrRateService },
    { provide: EXCHANGE_MANAGER_TOKEN, useClass: ExchangeManagerService },
  ],
  exports: [CBR_RATE_SERVICE_TOKEN, EXCHANGE_MANAGER_TOKEN, 'EnabledExchanges'],
})
export class CollectorModule {}
