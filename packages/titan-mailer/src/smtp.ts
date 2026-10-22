import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import type { MailerOptions } from './types.js';
import { MailDeliveryError } from './errors.js';
function positive(value: number | undefined, fallback: number, max: number): number {
  const n = value ?? fallback;
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) throw new MailDeliveryError('configuration');
  return n;
}
/** Explicitly parse URL fields; URL query parameters cannot disable TLS or enable file access. */
export function smtpOptions(options: MailerOptions): SMTPPool.Options {
  let url: URL;
  try {
    url = new URL(options.smtp);
  } catch {
    throw new MailDeliveryError('configuration');
  }
  if (
    !['smtp:', 'smtps:'].includes(url.protocol) ||
    !url.hostname ||
    url.search ||
    url.hash ||
    (url.pathname && url.pathname !== '/')
  )
    throw new MailDeliveryError('configuration');
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (options.allowInsecureLocalhost && !loopback) throw new MailDeliveryError('configuration');
  let auth: { user: string; pass: string } | undefined;
  try {
    if (url.username) auth = { user: decodeURIComponent(url.username), pass: decodeURIComponent(url.password) };
  } catch {
    throw new MailDeliveryError('configuration');
  }
  return {
    host: url.hostname.replace(/^\[|\]$/g, ''),
    port: positive(url.port ? Number(url.port) : undefined, url.protocol === 'smtps:' ? 465 : 587, 65535),
    secure: url.protocol === 'smtps:',
    requireTLS: url.protocol !== 'smtps:' && !(loopback && options.allowInsecureLocalhost),
    tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
    auth,
    pool: true,
    maxConnections: positive(options.pool?.maxConnections, 3, 100),
    maxMessages: positive(options.pool?.maxMessages, 100, 10000),
    // Only the durable outbox decides to retry an ambiguous SMTP attempt.
    maxRequeues: 0,
    connectionTimeout: positive(options.timeouts?.connection, 5000, 300000),
    greetingTimeout: positive(options.timeouts?.greeting, 5000, 300000),
    socketTimeout: positive(options.timeouts?.socket, 10000, 300000),
    dnsTimeout: positive(options.timeouts?.dns, 5000, 300000),
    disableFileAccess: true,
    disableUrlAccess: true,
    logger: false,
    debug: false,
  };
}
