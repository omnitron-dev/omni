/**
 * Priceverse - Charts Module
 * Handles OHLCV chart data and historical data
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { ChartsService } from './services/charts.service.js';
import { ChartsRpcService } from './charts.rpc-service.js';
import { CHARTS_SERVICE_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [{ provide: CHARTS_SERVICE_TOKEN, useClass: ChartsService }, ChartsRpcService],
  exports: [CHARTS_SERVICE_TOKEN],
})
export class ChartsModule { }
