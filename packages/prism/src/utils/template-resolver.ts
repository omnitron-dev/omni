/**
 * Template variable resolver.
 *
 * Replaces `{{namespace.key}}` patterns in text with values from a context map.
 * Used for injecting dynamic config values into help content at render time.
 *
 * @example
 * resolveTemplateVariables("Fee: {{config.sellerFee}}%", { "config.sellerFee": "5" })
 * // => "Fee: 5%"
 */
export function resolveTemplateVariables(text: string, context: Record<string, string | number>): string {
  return text.replace(/\{\{([a-zA-Z0-9_.]+)\}\}/g, (match, key: string) => {
    const value = context[key];
    return value !== undefined ? String(value) : match;
  });
}
