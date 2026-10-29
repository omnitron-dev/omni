/** Shared operational diagnostics, usable without starting the daemon. */
export { describeError, redactDiagnosticText, sanitizeDiagnostic } from '@omnitron-dev/titan/diagnostics';
export type { DiagnosticFinding, DiagnosticEvent, DiagnosticSink, DiagnosticReceipt, DiagnosticSeverity } from '@omnitron-dev/titan/diagnostics';
import { sanitizeDiagnostic, type DiagnosticSink, type DiagnosticEvent } from '@omnitron-dev/titan/diagnostics';

/** Payload delivered to monitoring.alertSink by the existing alert outbox. */
export interface AlertDiagnosticInput {
  eventId: string;
  status: 'firing' | 'resolved';
  ruleName: string;
  value: string;
  summary: string;
  host: string;
}

/** Bridge an exposed alert handler to any Titan diagnostic sink. No second queue or retries. */
export function createAlertDiagnosticHandler(sink: DiagnosticSink) {
  return async (input: AlertDiagnosticInput) => {
    if (!input || !['firing', 'resolved'].includes(input.status)) throw new Error('Invalid alert transition');
    if (typeof input.eventId !== 'string' || !/^[\w.-]{1,160}$/.test(input.eventId)) throw new Error('Invalid alert event id');
    const event: DiagnosticEvent = sanitizeDiagnostic({
      eventId: `${input.eventId}:${input.status}`, id: 'monitoring.alert', timestamp: Date.now(),
      source: 'omnitron.alerts', state: input.status === 'firing' ? 'raised' : 'resolved',
      severity: 'critical', title: input.ruleName, evidence: [input.value, input.summary],
      correlationId: input.eventId, resource: input.host,
      remedy: 'Inspect the alert rule, the affected node and its correlated logs.',
    });
    // Rejection must reach the outbox so it retains and retries this transition.
    return sink.deliver(event);
  };
}
