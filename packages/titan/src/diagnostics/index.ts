/** Transport-independent operational findings. No logger, database or messaging runtime is loaded here. */
export type DiagnosticSeverity = 'info' | 'warning' | 'error' | 'critical';
export interface DiagnosticFinding {
  /** Stable machine-readable identifier. */
  id: string;
  severity: DiagnosticSeverity;
  title: string;
  evidence: string[];
  remedy?: string;
}
export interface DiagnosticEvent extends DiagnosticFinding {
  /** Stable across delivery retries; a new transition gets a new event id. */
  eventId: string;
  timestamp: number;
  source: string;
  state: 'raised' | 'resolved';
  correlationId?: string;
  resource?: string;
}
export interface DiagnosticReceipt {
  /** Broker acceptance is distinct from delivery to a person. */
  status: 'queued' | 'duplicate';
  messageIds: string[];
}
export interface DiagnosticSink {
  deliver(event: DiagnosticEvent): Promise<DiagnosticReceipt>;
}

/** Redact common credential forms before a diagnostic leaves its process. */
export function redactDiagnosticText(value: string): string {
  return value
    .replace(/-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g, '[redacted private key]')
    .replace(/([a-z][a-z\d+.-]*:\/\/)[^\s/]*@/gi, '$1***@')
    .replace(/\b(Bearer|Basic)\s+[^\s,;]+/gi, '$1 ***')
    .replace(/([?&](?:[a-z_]*password|[a-z_]*token|[a-z_]*secret|[a-z_]*key)=)[^&#\s]*/gi, '$1***')
    .replace(/((?:["']?)(?:[\w-]*password|[\w-]*secret|[\w-]*token|api[_-]?key|authorization|cookie|set-cookie)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1***')
    .slice(0, 2048);
}

/** Bounded, cycle-safe cause formatting shared by frameworks and applications. */
export function describeError(error: unknown, depth = 0): string {
  const seen = new Set<object>();
  let remaining = 32;
  const visit = (value: unknown, level: number): string => {
    if (--remaining < 0) return 'further causes omitted';
    if (value === null || value === undefined) return 'unknown error';
    if (typeof value === 'string') return redactDiagnosticText(value.trim()) || 'unknown error';
    if (typeof value !== 'object') return String(value);
    if (seen.has(value) || level > 3) return 'unknown error';
    seen.add(value);
    try {
      const item = value as { message?: unknown; code?: unknown; cause?: unknown; errors?: unknown; name?: unknown };
      const message = typeof item.message === 'string' ? redactDiagnosticText(item.message.trim()) : '';
      const code = typeof item.code === 'string' || typeof item.code === 'number' ? String(item.code) : '';
      const reasons: string[] = [];
      if (message) reasons.push(code && !message.includes(code) ? `${message} (${code})` : message);
      if (Array.isArray(item.errors)) {
        for (const cause of item.errors.slice(0, 8)) reasons.push(visit(cause, level + 1));
      } else if (item.cause !== undefined) reasons.push(visit(item.cause, level + 1));
      const meaningful = [...new Set(reasons.filter(reason => reason !== 'unknown error'))];
      return meaningful.length ? meaningful.join('; ') : code || (typeof item.name === 'string' ? item.name : 'unknown error');
    } catch { return 'unreadable error'; }
  };
  return redactDiagnosticText(visit(error, depth));
}

/** Allowlist fields for delivery; never forward raw errors, stacks, headers or arbitrary metadata. */
export function sanitizeDiagnostic(event: DiagnosticEvent): DiagnosticEvent {
  for (const [field, value] of [['eventId', event.eventId], ['id', event.id], ['source', event.source]]) {
    if (typeof value !== 'string' || !/^[\w.:/-]{1,200}$/.test(value)) throw new Error(`Invalid diagnostic ${field}`);
  }
  if (!Number.isFinite(event.timestamp) || event.timestamp < 0) throw new Error('Invalid diagnostic timestamp');
  if (!['info', 'warning', 'error', 'critical'].includes(event.severity)) throw new Error('Invalid diagnostic severity');
  if (!['raised', 'resolved'].includes(event.state)) throw new Error('Invalid diagnostic state');
  if (typeof event.title !== 'string' || !Array.isArray(event.evidence) || !event.evidence.every(item => typeof item === 'string')) throw new Error('Invalid diagnostic content');
  const text = redactDiagnosticText;
  return {
    eventId: text(event.eventId), timestamp: event.timestamp, id: text(event.id),
    severity: event.severity, source: text(event.source), state: event.state,
    title: text(event.title), evidence: event.evidence.slice(0, 16).map(text),
    ...(event.remedy ? { remedy: text(event.remedy) } : {}),
    ...(event.correlationId ? { correlationId: text(event.correlationId) } : {}),
    ...(event.resource ? { resource: text(event.resource) } : {}),
  };
}
