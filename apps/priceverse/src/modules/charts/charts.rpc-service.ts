/**
 * Priceverse - Charts RPC Service
 * Netron-exposed chart endpoints
 */

import { Service, Method } from '@omnitron-dev/titan/netron';
import { Inject } from '@omnitron-dev/titan/decorators';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import {
  GetChartParamsSchema,
  GetOhlcvParamsSchema,
  type GetChartParams,
  type GetOhlcvParams,
} from '../../contracts/schemas.js';
import type { ChartResponse, OhlcvResponse } from '../../shared/types.js';
import { CHARTS_SERVICE_TOKEN } from '../../shared/tokens.js';
import type { ChartsService } from './services/charts.service.js';

@Service('ChartsService@2.0.0')
export class ChartsRpcService {
  constructor(
    @Inject(CHARTS_SERVICE_TOKEN) private readonly chartsService: ChartsService,
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule
  ) { }

  private get logger() {
    return this.loggerModule.logger;
  }

  /**
   * Get chart data for a pair
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * {
   *   "service": "ChartsService@2.0.0",
   *   "method": "getChartData",
   *   "input": {
   *     "pair": "btc-usd",
   *     "period": "7days",
   *     "interval": "1hour"
   *   }
   * }
   */
  @Method()
  async getChartData(params: GetChartParams): Promise<ChartResponse> {
    const validated = GetChartParamsSchema.parse(params);

    this.logger.debug(`[Charts RPC] getChartData: ${validated.pair}, ${validated.period}, ${validated.interval}`);

    return this.chartsService.getChartData(
      validated.pair,
      validated.period,
      validated.interval,
      validated.from,
      validated.to
    );
  }

  /**
   * Get OHLCV candles with pagination
   *
   * Netron RPC Call:
   * POST /netron/invoke
   * {
   *   "service": "ChartsService@2.0.0",
   *   "method": "getOHLCV",
   *   "input": {
   *     "pair": "btc-usd",
   *     "interval": "1hour",
   *     "limit": 100,
   *     "offset": 0
   *   }
   * }
   */
  @Method()
  async getOHLCV(params: GetOhlcvParams): Promise<OhlcvResponse> {
    const validated = GetOhlcvParamsSchema.parse(params);

    this.logger.debug(
      `[Charts RPC] getOHLCV: ${validated.pair}, ${validated.interval}, limit=${validated.limit}, offset=${validated.offset}`
    );

    return this.chartsService.getOhlcv(validated.pair, validated.interval, validated.limit, validated.offset);
  }
}
