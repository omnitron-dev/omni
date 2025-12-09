/**
 * Priceverse - Prices Module
 * Provides price retrieval and streaming functionality
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { PricesService } from './services/prices.service.js';
import { PricesRpcService } from './prices.rpc-service.js';
import { PRICES_SERVICE_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    { provide: PRICES_SERVICE_TOKEN, useClass: PricesService },
    PricesRpcService, // Register by class for Netron auto-exposure via @Service decorator
  ],
  exports: [PRICES_SERVICE_TOKEN],
})
export class PricesModule { }
