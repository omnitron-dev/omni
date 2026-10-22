import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import addressparser from 'nodemailer/lib/addressparser/index.js';
import { MailDeliveryError, mailFailure } from './errors.js';
import { smtpOptions } from './smtp.js';
import { validateRenderedMail } from './templates.js';
import type { MailerOptions, MailMessage, MailReceipt, MailSender } from './types.js';

function address(value: string): void {
  if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw new MailDeliveryError('invalid');
  const parsed = addressparser(value);
  if (
    parsed.length !== 1 ||
    !parsed[0] ||
    'group' in parsed[0] ||
    !parsed[0].address ||
    !/^[^\s<>@]+@[^\s<>@]+$/.test(parsed[0].address)
  )
    throw new MailDeliveryError('invalid');
}
export class MailerService implements MailSender {
  private readonly transport: Transporter<SMTPPool.SentMessageInfo>;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly maxPending: number;
  private closed = false;
  private closing?: Promise<void>;
  constructor(private readonly options: MailerOptions) {
    address(options.from);
    if (options.replyTo) address(options.replyTo);
    this.maxPending = options.maxPending ?? 1000;
    if (!Number.isSafeInteger(this.maxPending) || this.maxPending < 1) throw new MailDeliveryError('configuration');
    this.transport = nodemailer.createTransport(smtpOptions(options));
  }
  private run<T>(work: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new MailDeliveryError('closed'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new MailDeliveryError('capacity'));
    const task = Promise.resolve()
      .then(work)
      .catch((error) => {
        throw mailFailure(error);
      });
    this.pending.add(task);
    void task.finally(() => this.pending.delete(task)).catch(() => {});
    return task;
  }
  send(message: MailMessage): Promise<MailReceipt> {
    return this.run(async () => {
      validateRenderedMail(message);
      address(message.to);
      if (message.from) address(message.from);
      if (message.replyTo) address(message.replyTo);
      if (message.messageId && !/^<[^<>\s@]+@[^<>\s@]+>$/.test(message.messageId))
        throw new MailDeliveryError('invalid');
      for (const [key, value] of Object.entries(message.headers ?? {})) {
        if (
          !/^[A-Za-z0-9-]+$/.test(key) ||
          /^(to|cc|bcc|from|sender|reply-to|subject|message-id|return-path)$/i.test(key) ||
          /[\r\n\0]/.test(value)
        )
          throw new MailDeliveryError('invalid');
      }
      for (const file of message.attachments ?? []) {
        if (!Buffer.isBuffer(file.content) || !file.filename || /[\r\n\0]/.test(file.filename))
          throw new MailDeliveryError('invalid');
      }
      // Explicit fields prevent untyped callers overriding envelope / TLS / local file access.
      const info = await this.transport.sendMail({
        from: message.from ?? this.options.from,
        to: message.to,
        replyTo: message.replyTo ?? this.options.replyTo,
        subject: message.subject,
        text: message.text,
        html: message.html,
        messageId: message.messageId,
        headers: message.headers,
        attachments: message.attachments?.map((f) => ({
          filename: f.filename,
          content: f.content,
          contentType: f.contentType,
          cid: f.cid,
        })),
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (info.accepted.length !== 1 || info.rejected.length) throw new MailDeliveryError('permanent');
      return { messageId: info.messageId, accepted: info.accepted.map(String) };
    });
  }
  verify(): Promise<void> {
    return this.run(async () => {
      await this.transport.verify();
    });
  }
  close(): Promise<void> {
    this.closed = true;
    return (this.closing ??= Promise.allSettled([...this.pending]).then(() => this.transport.close()));
  }
  onDestroy(): Promise<void> {
    return this.close();
  }
}
