#!/usr/bin/env node
/**
 * Priceverse 2.0 - Interactive CLI Client
 *
 * Features:
 * - Real-time price monitoring dashboard
 * - Historical data visualization
 * - Command-line price queries
 * - Health status monitoring
 *
 * Usage:
 *   pnpm client                    # Quick price check for all pairs
 *   pnpm client btc-usd eth-usd    # Check specific pairs
 *   pnpm client --dashboard        # Interactive dashboard
 *   pnpm client --health           # Check server health
 *   pnpm client --history btc-usd  # Show price history
 */

import {
  spinner,
  table,
  box,
  note,
  log,
  prism,
  select,
  confirm,
} from '@xec-sh/kit';

import { HttpConnection } from '@omnitron-dev/titan/netron/transport/http';

import type {
  PairSymbol,
  PriceResponse,
  PriceChangeResponse,
  HealthResponse,
  HealthCheck,
  OhlcvCandle,
  ChartInterval,
  TimePeriod,
} from './shared/types.js';
import { SUPPORTED_PAIRS } from './shared/types.js';

import type {
  IPricesService,
  IChartsService,
  IHealthService,
} from './contracts/services.js';
import {
  PRICES_SERVICE_ID,
  CHARTS_SERVICE_ID,
  HEALTH_SERVICE_ID,
} from './contracts/services.js';

// ═══════════════════════════════════════════════════════════════════════════════
// Configuration
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULT_SERVER_URL = process.env.PRICEVERSE_URL || 'http://localhost:3000';
const REFRESH_INTERVAL = 5000; // 5 seconds for dashboard refresh

// ═══════════════════════════════════════════════════════════════════════════════
// Priceverse HTTP Client (using Netron HttpConnection)
// ═══════════════════════════════════════════════════════════════════════════════

class PriceverseClient {
  private connection: HttpConnection;
  private pricesService?: IPricesService;
  private chartsService?: IChartsService;
  private healthService?: IHealthService;

  constructor(baseUrl: string = DEFAULT_SERVER_URL) {
    this.connection = new HttpConnection(baseUrl, {
      timeout: 30000,
    });
  }

  /**
   * Get or create the PricesService proxy
   */
  private async getPricesService(): Promise<IPricesService> {
    if (!this.pricesService) {
      this.pricesService = await this.connection.queryInterface(PRICES_SERVICE_ID) as IPricesService;
    }
    return this.pricesService;
  }

  /**
   * Get or create the ChartsService proxy
   */
  private async getChartsService(): Promise<IChartsService> {
    if (!this.chartsService) {
      this.chartsService = await this.connection.queryInterface(CHARTS_SERVICE_ID) as IChartsService;
    }
    return this.chartsService;
  }

  /**
   * Get or create the HealthService proxy
   */
  private async getHealthService(): Promise<IHealthService> {
    if (!this.healthService) {
      this.healthService = await this.connection.queryInterface(HEALTH_SERVICE_ID) as IHealthService;
    }
    return this.healthService;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Prices Service
  // ─────────────────────────────────────────────────────────────────────────────

  async getPrice(pair: PairSymbol): Promise<PriceResponse> {
    const service = await this.getPricesService();
    return service.getPrice({ pair });
  }

  async getMultiplePrices(pairs: PairSymbol[]): Promise<PriceResponse[]> {
    const service = await this.getPricesService();
    return service.getMultiplePrices({ pairs });
  }

  async getPriceChange(
    pair: PairSymbol,
    period: TimePeriod = '24hours',
    from?: string,
    to?: string
  ): Promise<PriceChangeResponse> {
    const service = await this.getPricesService();
    return service.getPriceChange({ pair, period, from, to });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Charts Service
  // ─────────────────────────────────────────────────────────────────────────────

  async getOHLCV(
    pair: PairSymbol,
    interval: ChartInterval = '1hour',
    limit: number = 24,
    offset: number = 0
  ): Promise<{ candles: OhlcvCandle[]; pagination: { total: number; limit: number; offset: number } }> {
    const service = await this.getChartsService();
    return service.getOHLCV({ pair, interval, limit, offset });
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Health Service
  // ─────────────────────────────────────────────────────────────────────────────

  async checkHealth(): Promise<HealthResponse> {
    const service = await this.getHealthService();
    return service.check();
  }

  async liveness(): Promise<{ status: 'up' }> {
    const service = await this.getHealthService();
    return service.live();
  }

  /**
   * Close the connection and cleanup resources
   */
  async close(): Promise<void> {
    await this.connection.close();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Formatting Utilities
// ═══════════════════════════════════════════════════════════════════════════════

function formatPrice(price: number, currency: 'usd' | 'rub' = 'usd'): string {
  const symbol = currency === 'usd' ? '$' : '₽';
  if (price >= 1000) {
    return `${symbol}${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  return `${symbol}${price.toFixed(price < 1 ? 6 : 4)}`;
}

function formatChange(changePercent: number): string {
  const sign = changePercent >= 0 ? '+' : '';
  const formatted = `${sign}${changePercent.toFixed(2)}%`;
  if (changePercent > 0) {
    return prism.green(formatted);
  } else if (changePercent < 0) {
    return prism.red(formatted);
  }
  return prism.gray(formatted);
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`;
  if (minutes > 0) return `${minutes}m ${secs}s`;
  return `${secs}s`;
}

function getPairDisplayName(pair: string): string {
  const [base, quote] = pair.split('-');
  return `${base.toUpperCase()}/${quote.toUpperCase()}`;
}

function getCurrency(pair: string): 'usd' | 'rub' {
  return pair.endsWith('-rub') ? 'rub' : 'usd';
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI Commands
// ═══════════════════════════════════════════════════════════════════════════════

async function showPrices(client: PriceverseClient, pairs: PairSymbol[]): Promise<void> {
  const s = spinner({ style: 'dots' });
  s.start('Fetching prices...');

  try {
    const prices = await client.getMultiplePrices(pairs);
    s.stop('Prices fetched');

    if (prices.length === 0) {
      log.warn('No price data available');
      return;
    }

    // Fetch 24h changes for each pair
    const changesPromises = pairs.map((pair) =>
      client.getPriceChange(pair, '24hours').catch(() => null)
    );
    const changes = await Promise.all(changesPromises);

    const tableData = prices.map((p, i) => {
      const change = changes[i];
      return {
        pair: getPairDisplayName(p.pair),
        price: formatPrice(p.price, getCurrency(p.pair)),
        change24h: change ? formatChange(change.changePercent) : prism.gray('N/A'),
        updated: formatTimestamp(p.timestamp),
      };
    });

    console.log();
    table({
      data: tableData,
      columns: [
        { key: 'pair', header: 'Pair', width: 12, align: 'left' },
        { key: 'price', header: 'Price', width: 18, align: 'right' },
        { key: 'change24h', header: '24h Change', width: 12, align: 'right' },
        { key: 'updated', header: 'Updated', width: 18, align: 'center' },
      ],
      borders: 'rounded',
      showHeader: true,
    });
  } catch (error) {
    s.stop(prism.red('Failed'));
    log.error(`Failed to fetch prices: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function showHealth(client: PriceverseClient): Promise<void> {
  const s = spinner({ style: 'dots' });
  s.start('Checking server health...');

  try {
    const health = await client.checkHealth();
    s.stop('Health check complete');

    const statusColor =
      health.status === 'healthy'
        ? prism.green
        : health.status === 'degraded'
          ? prism.yellow
          : prism.red;

    const statusIcon =
      health.status === 'healthy' ? '●' : health.status === 'degraded' ? '◐' : '○';

    console.log();
    box(
      [
        `Status: ${statusColor(`${statusIcon} ${health.status.toUpperCase()}`)}`,
        `Version: ${prism.cyan(health.version)}`,
        `Uptime: ${prism.cyan(formatUptime(health.uptime))}`,
        `Timestamp: ${prism.dim(health.timestamp)}`,
        health.latency ? `Latency: ${prism.cyan(`${health.latency}ms`)}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      'Server Health',
      { rounded: true, titleAlign: 'center', contentPadding: 1 }
    );

    // Service checks
    const checksData = Object.entries(health.checks).map(([name, check]: [string, HealthCheck]) => ({
      service: name,
      status:
        check.status === 'up'
          ? prism.green('● UP')
          : prism.red('○ DOWN'),
      latency: check.latency ? `${check.latency}ms` : '-',
      message: check.message || '-',
    }));

    if (checksData.length > 0) {
      console.log();
      table({
        data: checksData,
        columns: [
          { key: 'service', header: 'Service', width: 15, align: 'left' },
          { key: 'status', header: 'Status', width: 10, align: 'center' },
          { key: 'latency', header: 'Latency', width: 10, align: 'right' },
          { key: 'message', header: 'Message', width: 30, align: 'left' },
        ],
        borders: 'rounded',
        showHeader: true,
      });
    }
  } catch (error) {
    s.stop(prism.red('Failed'));
    log.error(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

async function showHistory(
  client: PriceverseClient,
  pair: PairSymbol,
  interval: ChartInterval = '1hour',
  limit: number = 24
): Promise<void> {
  const s = spinner({ style: 'dots' });
  s.start(`Fetching ${interval} history for ${getPairDisplayName(pair)}...`);

  try {
    const result = await client.getOHLCV(pair, interval, limit);
    s.stop('History fetched');

    if (result.candles.length === 0) {
      log.warn(`No OHLCV data available for ${pair}`);
      return;
    }

    const currency = getCurrency(pair);

    const tableData = result.candles.map((candle) => {
      const change = ((candle.close - candle.open) / candle.open) * 100;
      return {
        time: new Date(candle.timestamp).toLocaleString('ru-RU', {
          day: '2-digit',
          month: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        }),
        open: formatPrice(candle.open, currency),
        high: formatPrice(candle.high, currency),
        low: formatPrice(candle.low, currency),
        close: formatPrice(candle.close, currency),
        change: formatChange(change),
        volume: candle.volume.toFixed(4),
      };
    });

    console.log();
    note(
      `${getPairDisplayName(pair)} - ${interval.toUpperCase()} candles (last ${result.candles.length})`,
      'OHLCV History'
    );
    console.log();

    table({
      data: tableData,
      columns: [
        { key: 'time', header: 'Time', width: 14, align: 'center' },
        { key: 'open', header: 'Open', width: 14, align: 'right' },
        { key: 'high', header: 'High', width: 14, align: 'right' },
        { key: 'low', header: 'Low', width: 14, align: 'right' },
        { key: 'close', header: 'Close', width: 14, align: 'right' },
        { key: 'change', header: 'Change', width: 10, align: 'right' },
        { key: 'volume', header: 'Volume', width: 12, align: 'right' },
      ],
      borders: 'rounded',
      showHeader: true,
    });

    console.log();
    log.info(`Total records: ${result.pagination.total}`);
  } catch (error) {
    s.stop(prism.red('Failed'));
    log.error(`Failed to fetch history: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Interactive Dashboard
// ═══════════════════════════════════════════════════════════════════════════════

async function runDashboard(client: PriceverseClient): Promise<void> {
  let running = true;

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    running = false;
    console.log('\n');
    log.info('Dashboard closed');
    process.exit(0);
  });

  const clearScreen = () => {
    process.stdout.write('\x1B[2J\x1B[0f');
  };

  const renderDashboard = async () => {
    clearScreen();

    // Header
    console.log(
      prism.bold.cyan(
        `
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         PRICEVERSE 2.0 - LIVE DASHBOARD                       ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`.trim()
      )
    );
    console.log();

    // Server status
    try {
      await client.liveness();
      console.log(
        `  Server: ${prism.green('● ONLINE')}  │  URL: ${prism.dim(DEFAULT_SERVER_URL)}  │  Time: ${prism.dim(new Date().toLocaleTimeString('ru-RU'))}`
      );
    } catch {
      console.log(`  Server: ${prism.red('○ OFFLINE')}  │  URL: ${prism.dim(DEFAULT_SERVER_URL)}`);
      console.log();
      log.error('Cannot connect to server. Retrying...');
      return;
    }

    console.log(prism.dim('─'.repeat(80)));
    console.log();

    // Prices section
    try {
      const prices = await client.getMultiplePrices(SUPPORTED_PAIRS as PairSymbol[]);

      // Split by currency
      const usdPairs = prices.filter((p) => p.pair.endsWith('-usd'));
      const rubPairs = prices.filter((p) => p.pair.endsWith('-rub'));

      // Fetch changes
      const changePromises = SUPPORTED_PAIRS.map((pair) =>
        client.getPriceChange(pair as PairSymbol, '24hours').catch(() => null)
      );
      const changes = await Promise.all(changePromises);
      const changeMap = new Map(
        changes.filter(Boolean).map((c: PriceChangeResponse | null) => [c!.pair, c!.changePercent])
      );

      // USD Section
      console.log(prism.bold('  💵 USD Prices'));
      console.log();

      const usdData = usdPairs.map((p) => ({
        pair: getPairDisplayName(p.pair),
        price: formatPrice(p.price, 'usd'),
        change: changeMap.has(p.pair) ? formatChange(changeMap.get(p.pair)!) : prism.gray('N/A'),
      }));

      table({
        data: usdData,
        columns: [
          { key: 'pair', header: 'Pair', width: 12, align: 'left' },
          { key: 'price', header: 'Price', width: 18, align: 'right' },
          { key: 'change', header: '24h', width: 12, align: 'right' },
        ],
        borders: 'rounded',
        showHeader: true,
        compact: true,
      });

      console.log();

      // RUB Section
      console.log(prism.bold('  ₽ RUB Prices'));
      console.log();

      const rubData = rubPairs.map((p) => ({
        pair: getPairDisplayName(p.pair),
        price: formatPrice(p.price, 'rub'),
        change: changeMap.has(p.pair) ? formatChange(changeMap.get(p.pair)!) : prism.gray('N/A'),
      }));

      table({
        data: rubData,
        columns: [
          { key: 'pair', header: 'Pair', width: 12, align: 'left' },
          { key: 'price', header: 'Price', width: 18, align: 'right' },
          { key: 'change', header: '24h', width: 12, align: 'right' },
        ],
        borders: 'rounded',
        showHeader: true,
        compact: true,
      });
    } catch (error) {
      log.error(`Price fetch error: ${error instanceof Error ? error.message : 'Unknown'}`);
    }

    console.log();
    console.log(prism.dim('─'.repeat(80)));
    console.log();

    // Health summary
    try {
      const health = await client.checkHealth();
      const statusIcon =
        health.status === 'healthy'
          ? prism.green('●')
          : health.status === 'degraded'
            ? prism.yellow('◐')
            : prism.red('○');

      const checksStatus = Object.entries(health.checks)
        .map(([name, check]: [string, HealthCheck]) => {
          const icon = check.status === 'up' ? prism.green('✓') : prism.red('✗');
          return `${icon} ${name}`;
        })
        .join('  │  ');

      console.log(`  Health: ${statusIcon} ${health.status.toUpperCase()}  │  ${checksStatus}`);
      console.log(`  Uptime: ${formatUptime(health.uptime)}`);
    } catch {
      console.log(`  Health: ${prism.red('○')} UNKNOWN`);
    }

    console.log();
    console.log(prism.dim(`  Press Ctrl+C to exit  │  Auto-refresh: ${REFRESH_INTERVAL / 1000}s`));
  };

  // Initial render
  await renderDashboard();

  // Refresh loop
  while (running) {
    await new Promise((resolve) => setTimeout(resolve, REFRESH_INTERVAL));
    if (running) {
      await renderDashboard();
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Interactive Menu
// ═══════════════════════════════════════════════════════════════════════════════

async function interactiveMenu(client: PriceverseClient): Promise<void> {
  console.log();
  box(
    'Interactive CLI for Priceverse cryptocurrency price aggregator',
    'PRICEVERSE 2.0 CLIENT',
    { rounded: true, titleAlign: 'center' }
  );
  console.log();

  while (true) {
    const action = await select({
      message: 'What would you like to do?',
      options: [
        { value: 'prices', label: 'View Current Prices', hint: 'All supported pairs' },
        { value: 'price-single', label: 'Check Single Pair', hint: 'Select specific pair' },
        { value: 'history', label: 'View Price History', hint: 'OHLCV candles' },
        { value: 'health', label: 'Server Health', hint: 'Check service status' },
        { value: 'dashboard', label: 'Live Dashboard', hint: 'Real-time monitoring' },
        { value: 'exit', label: 'Exit' },
      ],
    });

    if (action === 'exit') {
      log.info('Goodbye!');
      break;
    }

    switch (action) {
      case 'prices':
        await showPrices(client, SUPPORTED_PAIRS as PairSymbol[]);
        break;

      case 'price-single': {
        const pair = await select({
          message: 'Select trading pair:',
          options: SUPPORTED_PAIRS.map((p) => ({
            value: p,
            label: getPairDisplayName(p),
          })),
        });
        await showPrices(client, [pair as PairSymbol]);
        break;
      }

      case 'history': {
        const historyPair = await select({
          message: 'Select pair for history:',
          options: SUPPORTED_PAIRS.map((p) => ({
            value: p,
            label: getPairDisplayName(p),
          })),
        });
        const interval = await select({
          message: 'Select interval:',
          options: [
            { value: '5min', label: '5 Minutes' },
            { value: '1hour', label: '1 Hour' },
            { value: '1day', label: '1 Day' },
          ],
        });
        await showHistory(client, historyPair as PairSymbol, interval as ChartInterval);
        break;
      }

      case 'health':
        await showHealth(client);
        break;

      case 'dashboard':
        await runDashboard(client);
        break;
    }

    console.log();
    const continueChoice = await confirm({
      message: 'Continue?',
      initialValue: true,
    });

    if (!continueChoice) {
      log.info('Goodbye!');
      break;
    }
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Help Text
// ═══════════════════════════════════════════════════════════════════════════════

function showHelp(): void {
  console.log(`
${prism.bold.cyan('PRICEVERSE 2.0 CLIENT')}

${prism.bold('Usage:')}
  pnpm client [options] [pairs...]

${prism.bold('Options:')}
  --help, -h              Show this help message
  --dashboard, -d         Start live dashboard mode
  --health                Check server health status
  --history <pair>        Show OHLCV history for pair
  --interval <interval>   Interval for history (5min, 1hour, 1day)
  --limit <n>             Number of candles to show (default: 24)
  --url <url>             Server URL (default: ${DEFAULT_SERVER_URL})
  --interactive, -i       Start interactive menu mode

${prism.bold('Examples:')}
  pnpm client                         # Show all prices
  pnpm client btc-usd eth-usd         # Show specific pairs
  pnpm client --dashboard             # Live dashboard
  pnpm client --health                # Server health
  pnpm client --history btc-usd       # BTC/USD history
  pnpm client -i                      # Interactive mode

${prism.bold('Supported Pairs:')}
  ${SUPPORTED_PAIRS.map((p) => getPairDisplayName(p)).join(', ')}

${prism.bold('Environment Variables:')}
  PRICEVERSE_URL          Server URL (default: http://localhost:3000)
`);
}

// ═══════════════════════════════════════════════════════════════════════════════
// CLI Entry Point
// ═══════════════════════════════════════════════════════════════════════════════

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Parse flags
  const flags = {
    help: args.includes('--help') || args.includes('-h'),
    dashboard: args.includes('--dashboard') || args.includes('-d'),
    health: args.includes('--health'),
    interactive: args.includes('--interactive') || args.includes('-i'),
    history: args.includes('--history'),
  };

  // Extract values
  const getArgValue = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };

  const serverUrl = getArgValue('--url') || DEFAULT_SERVER_URL;
  const historyPair = getArgValue('--history') as PairSymbol | undefined;
  const interval = (getArgValue('--interval') || '1hour') as ChartInterval;
  const limit = parseInt(getArgValue('--limit') || '24', 10);

  // Filter out flags to get pairs
  const pairs = args.filter(
    (arg) =>
      !arg.startsWith('-') &&
      arg !== historyPair &&
      arg !== interval &&
      arg !== limit.toString() &&
      arg !== serverUrl
  ) as PairSymbol[];

  // Create client
  const client = new PriceverseClient(serverUrl);

  // Handle commands
  if (flags.help) {
    showHelp();
    return;
  }

  if (flags.dashboard) {
    await runDashboard(client);
    return;
  }

  if (flags.health) {
    await showHealth(client);
    return;
  }

  if (flags.history && historyPair) {
    await showHistory(client, historyPair, interval, limit);
    return;
  }

  if (flags.interactive) {
    await interactiveMenu(client);
    return;
  }

  // Default: show prices
  const targetPairs = pairs.length > 0 ? pairs : (SUPPORTED_PAIRS as PairSymbol[]);

  // Validate pairs
  const invalidPairs = targetPairs.filter((p) => !SUPPORTED_PAIRS.includes(p));
  if (invalidPairs.length > 0) {
    log.error(`Invalid pairs: ${invalidPairs.join(', ')}`);
    log.info(`Supported pairs: ${SUPPORTED_PAIRS.join(', ')}`);
    process.exit(1);
  }

  await showPrices(client, targetPairs);
}

// Run
main().catch((error) => {
  log.error(`Fatal error: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exit(1);
});
