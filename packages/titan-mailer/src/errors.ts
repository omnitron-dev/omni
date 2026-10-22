export type MailFailureKind = 'transient' | 'permanent' | 'configuration' | 'invalid' | 'closed' | 'capacity';
/** No SMTP transcript, credentials, recipient, or message body is attached to public errors. */
export class MailDeliveryError extends Error {
  readonly retryable: boolean;
  constructor(readonly kind: MailFailureKind) {
    super(`Mail delivery failed (${kind})`);
    this.name = 'MailDeliveryError';
    this.retryable = kind === 'transient' || kind === 'capacity';
  }
}
export function mailFailure(error: unknown): MailDeliveryError {
  if (error instanceof MailDeliveryError) return error;
  const value = error as { code?: unknown; originalCode?: unknown; responseCode?: unknown } | null;
  const code = value?.originalCode ?? value?.code;
  if (
    code === 'EAUTH' ||
    code === 'ETLS' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID' ||
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT'
  )
    return new MailDeliveryError('configuration');
  const status = value?.responseCode;
  return new MailDeliveryError(typeof status === 'number' && status >= 500 && status < 600 ? 'permanent' : 'transient');
}
