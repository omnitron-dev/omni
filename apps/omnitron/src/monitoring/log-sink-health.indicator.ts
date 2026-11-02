import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import type { ILoggerModule } from '@omnitron-dev/titan/module/logger';

/** Same delivery evidence for CLI and Console; a recovered sink can still have a gap. */
export class LogSinkHealthIndicator extends HealthIndicator {
  readonly name = 'log-sinks';
  constructor(private readonly logging: Pick<ILoggerModule, 'getSinkHealth'>) { super(); }
  async check(): Promise<HealthIndicatorResult> {
    const sinks = this.logging.getSinkHealth();
    const incomplete = sinks.filter(sink => sink.error || sink.unconfirmedBytes || sink.droppedBytes);
    // Custom transport errors may include credentials. Health reports identity
    // and counts; the developer-facing LoggerService API retains the cause.
    const evidence = sinks.map(({ error, ...sink }) => ({ ...sink, failed: error !== null }));
    return incomplete.length
      ? this.degraded(`${incomplete.length} log destination(s) have unconfirmed delivery; inspect output capacity and delivery gaps`, { sinks: evidence })
      : this.healthy('Log destinations have no recorded delivery gaps', { sinks: evidence });
  }
}
