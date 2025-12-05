/**
 * Priceverse 2.0 - Aggregator Module
 * Handles VWAP calculation and OHLCV aggregation
 */

import { Module } from '@omnitron-dev/titan/decorators';
import { StreamAggregatorService } from './services/stream-aggregator.service.js';
import { OhlcvAggregatorService } from './services/ohlcv-aggregator.service.js';
import { STREAM_AGGREGATOR_TOKEN, OHLCV_AGGREGATOR_TOKEN } from '../../shared/tokens.js';

@Module({
  providers: [
    { provide: STREAM_AGGREGATOR_TOKEN, useClass: StreamAggregatorService },
    { provide: OHLCV_AGGREGATOR_TOKEN, useClass: OhlcvAggregatorService },
  ],
  exports: [STREAM_AGGREGATOR_TOKEN, OHLCV_AGGREGATOR_TOKEN],
})
export class AggregatorModule {}
