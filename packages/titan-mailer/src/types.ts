import type { DynamicModule, InjectionToken } from '@omnitron-dev/titan/nexus';

export interface RenderedMail {
  subject: string;
  text: string;
  html?: string;
}
/** One envelope recipient per delivery: retries cannot duplicate a partially accepted fan-out. */
export interface MailMessage extends RenderedMail {
  to: string;
  from?: string;
  replyTo?: string;
  messageId?: string;
  headers?: Record<string, string>;
  attachments?: Array<{ filename: string; content: Buffer; contentType?: string; cid?: string }>;
}
export interface MailReceipt {
  messageId: string;
  accepted: string[];
}
export interface MailSender {
  send(message: MailMessage): Promise<MailReceipt>;
}
export interface MailerOptions {
  /** smtp: requires STARTTLS except when allowInsecureLocalhost is explicitly enabled. */
  smtp: string;
  from: string;
  replyTo?: string;
  allowInsecureLocalhost?: boolean;
  pool?: { maxConnections?: number; maxMessages?: number };
  /** Includes requests waiting for a pooled connection. Bounded independently of SMTP capacity. */
  maxPending?: number;
  timeouts?: { connection?: number; greeting?: number; socket?: number; dns?: number };
  verifyOnStart?: boolean;
}
export interface MailerAsyncOptions<Args extends unknown[] = unknown[]> {
  imports?: DynamicModule['imports'];
  inject?: { [K in keyof Args]: InjectionToken<Args[K]> };
  useFactory: (...args: Args) => MailerOptions | Promise<MailerOptions>;
  global?: boolean;
}
