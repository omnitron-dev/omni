import { MailDeliveryError } from './errors.js';
import type { RenderedMail } from './types.js';
export type MailTemplate<T> = (context: T) => RenderedMail;
export function validateRenderedMail(value: RenderedMail): RenderedMail {
  if (
    !value ||
    typeof value.subject !== 'string' ||
    !value.subject.trim() ||
    /[\r\n\0]/.test(value.subject) ||
    typeof value.text !== 'string' ||
    !value.text.trim() ||
    (value.html !== undefined && typeof value.html !== 'string')
  )
    throw new MailDeliveryError('invalid');
  return value;
}
/** Engine-independent, statically typed templates. Render once, persist the result transactionally. */
export class MailTemplates<Contexts extends object> {
  constructor(private readonly templates: { [K in keyof Contexts]: MailTemplate<Contexts[K]> }) {}
  render<K extends keyof Contexts>(name: K, context: Contexts[K]): RenderedMail {
    const render = this.templates[name];
    if (typeof render !== 'function') throw new MailDeliveryError('invalid');
    return validateRenderedMail(render(context));
  }
}
export function escapeMailHtml(value: string): string {
  const chars: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return value.replace(/[&<>"']/g, (char) => chars[char]!);
}
