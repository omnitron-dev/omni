import type { Nodes, Root } from 'hast';
import { raw } from 'hast-util-raw';

/** Parse serialized output with HTML5 tree construction, including entity decoding. */
export function htmlFragment(html: string): Root {
  const result = raw({ type: 'root', children: [{ type: 'raw', value: html }] });
  if (result.type !== 'root') throw new Error('Expected an HTML fragment');
  return result;
}

export function htmlNodes(node: Nodes): Nodes[] {
  return [node, ...('children' in node ? node.children.flatMap(htmlNodes) : [])];
}

export function htmlText(html: string): string {
  return htmlNodes(htmlFragment(html)).flatMap(node => node.type === 'text' ? [node.value] : []).join('');
}
