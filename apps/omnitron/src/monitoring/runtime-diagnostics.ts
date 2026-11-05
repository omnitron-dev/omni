import { randomUUID } from 'node:crypto';
import { HealthIndicator, type HealthIndicatorResult } from '@omnitron-dev/titan-health';
import { describeError, sanitizeDiagnostic, type DiagnosticEvent, type DiagnosticFinding } from '@omnitron-dev/titan/diagnostics';
import type { ILogger } from '@omnitron-dev/titan/module/logger';
import { writeEmergencyStderr } from '../shared/emergency-output.js';

/** Bounded health projection. The existing daemon log remains the persistent record. */
export class RuntimeDiagnostics extends HealthIndicator {
  readonly name = 'runtime-diagnostics';
  private logger?: Pick<ILogger, 'info' | 'warn' | 'error'>;
  private readonly active = new Map<string, { event: DiagnosticEvent; occurrences: number; lastLoggedAt: number }>();
  private total = 0;
  private dropped = 0;
  private readonly output = { failedWrites: 0, lastError: null as string | null, lastFailedAt: null as number | null };

  constructor(private readonly limit = 100) {
    super();
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Diagnostic capacity must be a positive integer');
  }

  setLogger(logger: Pick<ILogger, 'info' | 'warn' | 'error'>): void { this.logger = logger; }

  record(finding: DiagnosticFinding, error?: unknown): DiagnosticEvent {
    const event = sanitizeDiagnostic({ ...finding, evidence: [...finding.evidence, ...(error === undefined ? [] : [describeError(error)])],
      eventId: randomUUID(), timestamp: Date.now(), source: 'omnitron.daemon', state: 'raised' });
    const previous = this.active.get(event.id);
    this.total++;
    if (!previous && this.active.size >= this.limit) {
      this.active.delete(this.active.keys().next().value!);
      this.dropped++;
    }
    const occurrences = (previous?.occurrences ?? 0) + 1;
    // Repeats are counted; log the transition and periodically refresh its evidence.
    const shouldLog = !previous || event.timestamp - previous.lastLoggedAt >= 60_000 || occurrences % 100 === 0
      || previous.event.severity !== event.severity;
    this.active.set(event.id, { event, occurrences, lastLoggedAt: shouldLog ? event.timestamp : previous.lastLoggedAt });
    if (shouldLog) this.write(event, occurrences);
    return event;
  }

  failure(id: string, title: string, error: unknown, remedy = 'Inspect the diagnostic and daemon logs, repair the failing dependency, then verify the next successful run.'): void {
    this.record({ id, title, severity: 'error', evidence: [], remedy }, error);
  }

  resolve(id: string): void {
    const prior = this.active.get(id);
    if (!prior) return;
    this.active.delete(id);
    this.write({ ...prior.event, eventId: randomUUID(), timestamp: Date.now(), state: 'resolved' }, prior.occurrences);
  }

  snapshot() {
    return { total: this.total, dropped: this.dropped, output: { ...this.output }, active: [...this.active.values()].map(({ event, occurrences }) => ({ occurrences, event: { ...event, evidence: [...event.evidence] } })) };
  }

  async check(): Promise<HealthIndicatorResult> {
    const state = this.snapshot();
    if (!state.active.length && !state.dropped && !state.output.lastError) return this.healthy('No unresolved runtime diagnostics', state);
    const title = state.active.slice(0, 3).map(({ event }) => `${event.id}: ${event.title}`).join('; ');
    const outputFailure = state.output.lastError ? ` Diagnostic output failed: ${state.output.lastError}.` : '';
    return this.degraded(`${state.active.length} unresolved runtime diagnostic(s)${state.dropped ? `; ${state.dropped} older records evicted from memory` : ''}. ${title}${outputFailure}`, state);
  }

  private write(event: DiagnosticEvent, occurrences: number): void {
    let loggerFailure: unknown;
    const level = event.state === 'resolved' || event.severity === 'info' ? 'info' : event.severity === 'warning' ? 'warn' : 'error';
    if (this.logger) {
      try {
        this.logger[level]({ diagnostic: event, occurrences }, event.title);
        this.output.lastError = null;
        return;
      } catch (error) { loggerFailure = error; }
    }
    try {
      writeEmergencyStderr(Buffer.from(JSON.stringify({ level, time: event.timestamp, msg: event.title, diagnostic: event, occurrences,
        ...(loggerFailure !== undefined && { loggingFailed: true, loggerError: describeError(loggerFailure) }) }) + '\n'));
      this.output.lastError = null;
    } catch (error) {
      // No recursive logging, stream error event or unbounded queue when the
      // final destination is unavailable. Memory health remains truthful.
      this.output.failedWrites++;
      this.output.lastFailedAt = event.timestamp;
      this.output.lastError = describeError(error);
    }
  }
}

export const runtimeDiagnostics = new RuntimeDiagnostics();
