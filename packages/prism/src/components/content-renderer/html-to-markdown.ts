import type { Node, Filter } from 'turndown';
import TurndownService from 'turndown';
import { htmlTags } from './html-tags.js';

// ---------------------------------------------------------------------------
// Turndown service — converts HTML strings to Markdown
// ---------------------------------------------------------------------------

type INode = HTMLElement & { isBlock: boolean };

const excludeTags = ['pre', 'code'];
const filterTags = htmlTags.filter((t) => !excludeTags.includes(t)) as Filter;

const turndownService = new TurndownService({ codeBlockStyle: 'fenced', fence: '```' });

// Keep all HTML tags that aren't code-related
turndownService.addRule('keep', {
  filter: filterTags,
  replacement(content: string, node: Node) {
    const { isBlock, outerHTML } = node as INode;
    return node && isBlock ? `\n\n${outerHTML}\n\n` : outerHTML;
  },
});

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function htmlToMarkdown(html: string): string {
  return turndownService.turndown(html);
}

/**
 * Detect whether content is already Markdown or raw HTML.
 * Checks for common Markdown syntax patterns.
 */
export function isMarkdownContent(content: string): boolean {
  const patterns = [
    /^#+\s/m, // Heading
    /^(\*|-|\d+\.)\s/m, // List item
    /^```/m, // Code block
    /^\|/m, // Table
    /!\[.*?\]\(.*?\)/, // Image
    /\[.*?\]\(.*?\)/, // Link
  ];
  return patterns.some((p) => p.test(content));
}
