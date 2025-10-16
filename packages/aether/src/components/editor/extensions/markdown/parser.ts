/**
 * Markdown parser - converts markdown strings to ProseMirror documents
 */

import type { Node as PMNode, Schema } from 'prosemirror-model';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Root, Content, PhrasingContent } from 'mdast';

/**
 * Parse markdown string to ProseMirror document
 */
export function parseMarkdown(markdown: string, schema: Schema): PMNode {
  const processor = unified().use(remarkParse).use(remarkGfm);

  const ast = processor.parse(markdown);
  const doc = convertMdastToProseMirror(ast as Root, schema);

  return doc;
}

/**
 * Convert MDAST tree to ProseMirror document
 */
function convertMdastToProseMirror(root: Root, schema: Schema): PMNode {
  const content = root.children.map((node) => convertNode(node, schema)).filter(Boolean) as PMNode[];

  // Ensure at least one paragraph exists
  if (content.length === 0) {
    content.push(schema.nodes.paragraph.create());
  }

  return schema.node('doc', null, content);
}

/**
 * Convert a single MDAST node to ProseMirror node
 */
function convertNode(node: Content, schema: Schema): PMNode | null {
  switch (node.type) {
    case 'paragraph':
      return convertParagraph(node, schema);

    case 'heading':
      return convertHeading(node, schema);

    case 'blockquote':
      return convertBlockquote(node, schema);

    case 'code':
      return convertCodeBlock(node, schema);

    case 'list':
      return convertList(node, schema);

    case 'listItem':
      return convertListItem(node, schema);

    case 'thematicBreak':
      return schema.nodes.horizontalRule?.create() || null;

    case 'table':
      return convertTable(node, schema);

    case 'tableRow':
      return convertTableRow(node, schema);

    case 'tableCell':
      return convertTableCell(node, schema, false);

    default:
      return null;
  }
}

/**
 * Convert paragraph node
 */
function convertParagraph(node: any, schema: Schema): PMNode {
  const content = convertInlineContent(node.children || [], schema);
  return schema.nodes.paragraph.create(null, content);
}

/**
 * Convert heading node
 */
function convertHeading(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.heading) return null;

  const content = convertInlineContent(node.children || [], schema);
  return schema.nodes.heading.create({ level: node.depth }, content);
}

/**
 * Convert blockquote node
 */
function convertBlockquote(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.blockquote) return null;

  const content = node.children.map((child: any) => convertNode(child, schema)).filter(Boolean) as PMNode[];
  return schema.nodes.blockquote.create(null, content);
}

/**
 * Convert code block node
 */
function convertCodeBlock(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.codeBlock) return null;

  const attrs = node.lang ? { language: node.lang } : {};
  return schema.nodes.codeBlock.create(attrs, schema.text(node.value || ''));
}

/**
 * Convert list node
 */
function convertList(node: any, schema: Schema): PMNode | null {
  const ordered = node.ordered;
  const listType = ordered ? schema.nodes.orderedList : schema.nodes.bulletList;

  if (!listType || !schema.nodes.listItem) return null;

  const items = node.children.map((child: any) => {
    // Child should be a list item
    const content = child.children.map((grandChild: any) => convertNode(grandChild, schema)).filter(Boolean) as PMNode[];

    // Ensure at least one paragraph if content is empty
    if (content.length === 0 && schema.nodes.paragraph) {
      content.push(schema.nodes.paragraph.create());
    }

    // Handle task list items
    if (child.checked !== null && child.checked !== undefined && schema.nodes.taskItem) {
      return schema.nodes.taskItem.create({ checked: child.checked }, content);
    }

    return schema.nodes.listItem.create(null, content);
  }).filter(Boolean) as PMNode[];

  return listType.create(ordered ? { order: node.start || 1 } : null, items);
}

/**
 * Convert list item node (when called directly)
 */
function convertListItem(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.listItem) return null;

  const content = node.children.map((child: any) => convertNode(child, schema)).filter(Boolean) as PMNode[];

  // Ensure at least one paragraph if content is empty
  if (content.length === 0 && schema.nodes.paragraph) {
    content.push(schema.nodes.paragraph.create());
  }

  // Handle task list items
  if (node.checked !== null && node.checked !== undefined && schema.nodes.taskItem) {
    return schema.nodes.taskItem.create({ checked: node.checked }, content);
  }

  return schema.nodes.listItem.create(null, content);
}

/**
 * Convert table node
 */
function convertTable(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.table) return null;

  const rows = node.children.map((child: any) => convertTableRow(child, schema)).filter(Boolean) as PMNode[];
  return schema.nodes.table.create(null, rows);
}

/**
 * Convert table row node
 */
function convertTableRow(node: any, schema: Schema): PMNode | null {
  if (!schema.nodes.tableRow) return null;

  const cells = node.children.map((child: any, index: number) => {
    // First row is header
    const isHeader = node.position?.start.line === node.position?.end.line;
    return convertTableCell(child, schema, isHeader);
  }).filter(Boolean) as PMNode[];

  return schema.nodes.tableRow.create(null, cells);
}

/**
 * Convert table cell node
 */
function convertTableCell(node: any, schema: Schema, isHeader: boolean): PMNode | null {
  const cellType = isHeader && schema.nodes.tableHeader ? schema.nodes.tableHeader : schema.nodes.tableCell;
  if (!cellType) return null;

  const content = convertInlineContent(node.children || [], schema);
  return cellType.create(null, content.length > 0 ? content : [schema.nodes.paragraph.create()]);
}

/**
 * Convert inline content (text, emphasis, strong, etc.)
 */
function convertInlineContent(nodes: PhrasingContent[], schema: Schema): PMNode[] {
  const result: PMNode[] = [];

  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        result.push(schema.text(node.value));
        break;

      case 'emphasis':
        if (schema.marks.italic) {
          const content = convertInlineContent(node.children, schema);
          content.forEach((n) => {
            if (n.isText) {
              result.push(n.mark(schema.marks.italic.create().addToSet(n.marks)));
            }
          });
        }
        break;

      case 'strong':
        if (schema.marks.bold) {
          const content = convertInlineContent(node.children, schema);
          content.forEach((n) => {
            if (n.isText) {
              result.push(n.mark(schema.marks.bold.create().addToSet(n.marks)));
            }
          });
        }
        break;

      case 'inlineCode':
        if (schema.marks.code) {
          result.push(schema.text(node.value).mark([schema.marks.code.create()]));
        } else {
          result.push(schema.text(node.value));
        }
        break;

      case 'delete':
        if (schema.marks.strike) {
          const content = convertInlineContent(node.children, schema);
          content.forEach((n) => {
            if (n.isText) {
              result.push(n.mark(schema.marks.strike.create().addToSet(n.marks)));
            }
          });
        }
        break;

      case 'link':
        if (schema.marks.link) {
          const content = convertInlineContent(node.children, schema);
          const linkMark = schema.marks.link.create({
            href: node.url,
            title: node.title || null,
          });
          content.forEach((n) => {
            if (n.isText) {
              result.push(n.mark(linkMark.addToSet(n.marks)));
            }
          });
        }
        break;

      case 'break':
        if (schema.nodes.hardBreak) {
          result.push(schema.nodes.hardBreak.create());
        }
        break;

      case 'image':
        if (schema.nodes.image) {
          result.push(
            schema.nodes.image.create({
              src: node.url,
              alt: node.alt || null,
              title: node.title || null,
            }),
          );
        }
        break;

      default:
        // Handle other inline nodes
        break;
    }
  }

  return result;
}
