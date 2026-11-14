/** The declared CLI envelope is shared by native updates and Xec orchestration. */
type RecordValue = Record<string, unknown>;
const record = (value: unknown): value is RecordValue => value !== null && typeof value === 'object' && !Array.isArray(value);
const message = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value : undefined;

export class CommandResultError extends Error {
  readonly code: string | number;
  readonly details: RecordValue;
  readonly exitCode: number;
  readonly reply: RecordValue | undefined;

  constructor(command: string, status: number | string, reply?: RecordValue, cause?: unknown) {
    const data = record(reply?.['data']) ? reply['data'] : undefined;
    const error = reply?.['error'];
    const targets = Array.isArray(data?.['targets']) ? data['targets'].flatMap(target => {
      if (!record(target)) return [];
      const reason = message(target['reason']);
      const name = message(target['node']) ?? message(target['name']);
      return reason ? [name ? `${name}: ${reason}` : reason] : [];
    }) : [];
    const reason = message(error) ?? (record(error) ? message(error['message']) : undefined)
      ?? message(data?.['reason']) ?? message(data?.['because']) ?? (targets.length ? targets.join('; ') : undefined);
    super(reason ?? `${command} did not confirm its result. Inspect its state before retrying.`, { cause });
    this.name = 'CommandResultError';
    this.exitCode = typeof status === 'number' && Number.isSafeInteger(status) && status > 0 && status < 256 ? status : 1;
    this.code = typeof reply?.['code'] === 'string' || typeof reply?.['code'] === 'number' && Number.isFinite(reply['code'])
      ? reply['code'] : 'CLI_RESULT_UNCONFIRMED';
    this.reply = reply;
    // Retain the public structured receipt, never raw process output or attached state.
    this.details = { command, exitCode: this.exitCode,
      ...(reply?.['details'] !== undefined && { reported: reply['details'] }),
      ...(reply && Object.hasOwn(reply, 'data') && { result: reply['data'] }) };
  }
}

/** A JSON receipt cannot turn a nonzero process exit into successful execution. */
export function readCommandResult<T>(output: string, command: string, status: number | string = 0, cause?: unknown): T {
  let reply: unknown;
  try { reply = JSON.parse(output); }
  catch (error) {
    if (cause !== undefined) throw cause;
    throw new CommandResultError(command, status, undefined, error);
  }
  if (!record(reply) || reply['ok'] !== true || status !== 0)
    throw new CommandResultError(command, status, record(reply) ? reply : undefined, cause);
  return reply['data'] as T;
}
