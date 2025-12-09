/**
 * Priceverse - Prices Module
 * Provides price retrieval and streaming functionality
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { PricesService } from './services/prices.service.js';
import { PricesRpcService } from './prices.rpc-service.js';

@Module({
  providers: [
    { provide: 'PricesService', useClass: PricesService },
    { provide: 'PricesRpcService', useClass: PricesRpcService },
    PricesRpcService, // Also register by class for Netron auto-exposure
  ],
  exports: ['PricesService', 'PricesRpcService'],
})
export class PricesModule { }
