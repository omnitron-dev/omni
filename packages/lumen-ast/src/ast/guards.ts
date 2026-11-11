/**
 * Type guards for Lumen AST Nodes
 */

import type {
  LumenAdmonitionNode,
  LumenCodeBlockNode,
  LumenDiagramNode,
  LumenHeadingNode,
  LumenJsxWidgetNode,
  LumenMathBlockNode,
  LumenMathEnvironmentNode,
  LumenMathInlineNode,
  LumenNode,
  LumenParagraphNode,
  LumenSmartRefNode,
  LumenTabsNode,
  LumenTextNode,
} from './types.js';

export function isMathEnvironment(node: LumenNode): node is LumenMathEnvironmentNode {
  return node.type === 'mathEnvironment';
}

export function isSmartRef(node: LumenNode): node is LumenSmartRefNode {
  return node.type === 'smartRef';
}

export function isJsxWidget(node: LumenNode): node is LumenJsxWidgetNode {
  return node.type === 'jsxWidget';
}

export function isDiagram(node: LumenNode): node is LumenDiagramNode {
  return node.type === 'diagram';
}

export function isAdmonition(node: LumenNode): node is LumenAdmonitionNode {
  return node.type === 'admonition';
}

export function isTabs(node: LumenNode): node is LumenTabsNode {
  return node.type === 'tabs';
}

export function isHeading(node: LumenNode): node is LumenHeadingNode {
  return node.type === 'heading';
}

export function isCodeBlock(node: LumenNode): node is LumenCodeBlockNode {
  return node.type === 'codeBlock';
}

export function isParagraph(node: LumenNode): node is LumenParagraphNode {
  return node.type === 'paragraph';
}

export function isText(node: LumenNode): node is LumenTextNode {
  return node.type === 'text';
}

export function isMathInline(node: LumenNode): node is LumenMathInlineNode {
  return node.type === 'mathInline';
}

export function isMathBlock(node: LumenNode): node is LumenMathBlockNode {
  return node.type === 'mathBlock';
}
