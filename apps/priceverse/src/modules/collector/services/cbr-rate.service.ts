/**
 * Priceverse - CBR USD/RUB Rate Service
 * Fetches official USD/RUB exchange rate from Central Bank of Russia
 */

import { Injectable, Inject, PostConstruct } from '@omnitron-dev/titan/decorators';
import { RedisService } from '@omnitron-dev/titan/module/redis';
import { LOGGER_SERVICE_TOKEN, type ILoggerModule } from '@omnitron-dev/titan/module/logger';
import { parseStringPromise } from 'xml2js';
import type { ILogger, IRedisService } from '../workers/base-worker.js';

const CBR_URL = 'https://www.cbr.ru/scripts/XML_daily.asp';
const USD_CHAR_CODE = 'USD';
const CACHE_KEY = 'rate:usd-rub';
const CACHE_TTL = 3600; // 1 hour

interface CbrValute {
  CharCode: string[];
  Value: string[];
}

interface CbrResponse {
  ValCurs: {
    Valute: CbrValute[];
  };
}

@Injectable()
export class CbrRateService {
  private lastFetchTime = 0;
  private cachedRate = 0;

  constructor(
    @Inject(RedisService) private readonly redis: IRedisService & {
      get(key: string): Promise<string | null>;
      setex(key: string, ttl: number, value: string): Promise<void>;
    },
    @Inject(LOGGER_SERVICE_TOKEN) private readonly loggerModule: ILoggerModule,
  ) { }

  private get logger(): ILogger {
    return this.loggerModule.logger;
  }

  @PostConstruct()
  async initialize(): Promise<void> {
    await this.fetchRate();
  }

  /**
   * Fetch rate from CBR - called by scheduler every hour
   */
  async fetchRate(): Promise<void> {
    try {
      this.logger.info('[CBR] Fetching USD/RUB rate');

      const response = await fetch(CBR_URL);
      const xmlText = await response.text();
      const parsed = (await parseStringPromise(xmlText)) as CbrResponse;

      const valutes = parsed.ValCurs.Valute;
      const usd = valutes.find((v) => v.CharCode[0] === USD_CHAR_CODE);

      if (usd) {
        const rateStr = usd.Value[0].replace(',', '.');
        const rate = parseFloat(rateStr);

        await this.redis.setex(CACHE_KEY, CACHE_TTL, rate.toString());

        this.cachedRate = rate;
        this.lastFetchTime = Date.now();

        this.logger.info(`[CBR] USD/RUB rate updated: ${rate}`);
      } else {
        this.logger.warn('[CBR] USD not found in CBR response');
      }
    } catch (error) {
      this.logger.error('[CBR] Failed to fetch rate:', error);
    }
  }

  /**
   * Get current USD/RUB rate
   */
  async getRate(): Promise<number> {
    // Try cache first
    const cached = await this.redis.get(CACHE_KEY);
    if (cached) {
      return parseFloat(cached);
    }

    // Return in-memory cache
    if (this.cachedRate > 0) {
      return this.cachedRate;
    }

    // Fetch fresh rate
    await this.fetchRate();
    return this.cachedRate;
  }

  /**
   * Check if rate is stale (older than 2 hours)
   */
  isRateStale(): boolean {
    const twoHours = 2 * 60 * 60 * 1000;
    return Date.now() - this.lastFetchTime > twoHours;
  }
}
