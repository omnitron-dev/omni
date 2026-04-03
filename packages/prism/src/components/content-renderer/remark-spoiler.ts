/**
 * Remark plugin for spoiler syntax: ||hidden text||
 *
 * Transforms `||spoiler text||` into `<span class="...">spoiler text</span>`
 * in the markdown AST. Works with rehype-raw to render the HTML.
 */

import { contentClasses } from './classes.js';

const SPOILER_RE = /\|\|(.+?)\|\|/g;

function remarkSpoiler(): (tree: any) => void {
  return (tree) => {
    visitNode(tree);
  };
}

function visitNode(node: any): void {
  if (!node.children) return;

  const newChildren: any[] = [];
  let changed = false;

  for (const child of node.children) {
    if (child.type === 'text' && typeof child.value === 'string') {
      if (SPOILER_RE.test(child.value)) {
        changed = true;
        let lastIndex = 0;
        SPOILER_RE.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = SPOILER_RE.exec(child.value)) !== null) {
          if (match.index > lastIndex) {
            newChildren.push({ type: 'text', value: child.value.slice(lastIndex, match.index) });
          }
          newChildren.push({
            type: 'html',
            value: `<span class="${contentClasses.spoiler}">${escapeHtml(match[1])}</span>`,
          });
          lastIndex = match.index + match[0].length;
        }
        if (lastIndex < child.value.length) {
          newChildren.push({ type: 'text', value: child.value.slice(lastIndex) });
        }
        continue;
      }
    } else {
      visitNode(child);
    }
    newChildren.push(child);
  }

  if (changed) {
    node.children = newChildren;
  }
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export { remarkSpoiler };
