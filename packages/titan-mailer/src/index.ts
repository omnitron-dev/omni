export { MailerService } from './mailer.service.js';
export { MailerModule, MAILER, MAILER_OPTIONS } from './mailer.module.js';
export { MailDeliveryError, mailFailure } from './errors.js';
export type { MailFailureKind } from './errors.js';
export { smtpOptions } from './smtp.js';
export { MailTemplates, escapeMailHtml, validateRenderedMail } from './templates.js';
export type { MailTemplate } from './templates.js';
export type { MailerOptions, MailerAsyncOptions, MailMessage, MailReceipt, MailSender, RenderedMail } from './types.js';
