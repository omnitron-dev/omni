/**
 * Priceverse 2.0 - Prices RPC Service
 * Netron RPC interface for price operations
 */

import { Service, Method } from '@omnitron-dev/titan/netron';
import { Inject } from '@omnitron-dev/titan/decorators';
import type { PricesService } from './services/prices.service.js';
import type { PairSymbol, PriceResponse, PriceChangeResponse, TimePeriod } from '../../shared/types.js';
import {
  GetPriceParamsSchema,
  GetMultiplePricesParamsSchema,
  GetPriceChangeParamsSchema,
  type GetPriceParams,
  type GetMultiplePricesParams,
  type GetPriceChangeParams,
} from '../../contracts/schemas.js';
import { PriceVerseError, PriceVerseErrorCode } from '../../contracts/errors.js';

@Service('PricesService@2.0.0')
export class PricesRpcService {
  constructor(@Inject('PricesService') private readonly pricesService: PricesService) {}

  /**
   * Get current price for a trading pair
   */
  @Method()
  async getPrice(params: GetPriceParams): Promise<PriceResponse> {
    const validated = GetPriceParamsSchema.parse(params);
    return this.pricesService.getPrice(validated.pair as PairSymbol);
  }

  /**
   * Get current prices for multiple trading pairs
   */
  @Method()
  async getMultiplePrices(params: GetMultiplePricesParams): Promise<PriceResponse[]> {
    const validated = GetMultiplePricesParamsSchema.parse(params);
    return this.pricesService.getMultiplePrices(validated.pairs as PairSymbol[]);
  }

  /**
   * Calculate price change percentage over a period
   */
  @Method()
  async getPriceChange(params: GetPriceChangeParams): Promise<PriceChangeResponse> {
    const validated = GetPriceChangeParamsSchema.parse(params);
    return this.pricesService.getPriceChange(
      validated.pair as PairSymbol,
      validated.period as TimePeriod,
      validated.from,
      validated.to
    );
  }

  /**
   * Stream real-time price updates (server-to-client streaming)
   * Note: Streaming support depends on Netron transport implementation
   */
  @Method()
  async *streamPrices(params: GetMultiplePricesParams): AsyncGenerator<PriceResponse> {
    const validated = GetMultiplePricesParamsSchema.parse(params);

    if (!validated.pairs || validated.pairs.length === 0) {
      throw new PriceVerseError(PriceVerseErrorCode.INVALID_PARAMS, 'At least one pair must be specified', { pairs: validated.pairs });
    }

    yield* this.pricesService.streamPrices(validated.pairs as PairSymbol[]);
  }
}
