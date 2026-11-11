/**
 * AST Node Types & Interfaces for prism-doc/2
 */

import type { LumenFrontmatter } from './frontmatter.js';
import type { LumenDiagnostic } from './diagnostics.js';
import type { MathEnvType, MathStatus } from '../math/environments.js';

export interface Point {
  line: number;
  column: number;
  offset?: number;
}

export interface Position {
  start: Point;
  end: Point;
}

export interface LumenBaseNode {
  type: string;
  data?: Record<string, unknown>;
  position?: Position;
  children?: LumenNode[];
  value?: string;
  depth?: 1 | 2 | 3 | 4 | 5 | 6;
  id?: string;
  title?: string;
  status?: MathStatus;
  envKind?: MathEnvType | string;
  number?: string;
  unnumbered?: boolean;
  of?: string;
  for?: string;
  dependsOn?: string[];
  proves?: string[];
  kind?: string;
  syncKey?: string;
  label?: string;
  engine?: string;
  code?: string;
  elk?: boolean;
  name?: string;
  props?: Record<string, unknown>;
  isSelfClosing?: boolean;
  raw?: string;
  ordered?: boolean;
  url?: string;
  tex?: string;
  lang?: string;
  meta?: string;
  domain?: string;
  target?: string;
  symbol?: string;
  package?: string;
  access?: string;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface LumenRootNode extends LumenBaseNode {
  type: 'root';
  children: LumenNode[];
}

export interface LumenParagraphNode extends LumenBaseNode {
  type: 'paragraph';
  children: LumenNode[];
}

export interface LumenHeadingNode extends LumenBaseNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  id: string;
  access?: string;
  attributes?: Record<string, unknown>;
  children: LumenNode[];
}

export interface LumenTextNode extends LumenBaseNode {
  type: 'text';
  value: string;
}

export interface LumenInlineCodeNode extends LumenBaseNode {
  type: 'inlineCode';
  value: string;
}

export interface LumenCodeBlockNode extends LumenBaseNode {
  type: 'codeBlock';
  lang?: string;
  meta?: string;
  value: string;
}

export interface LumenMathInlineNode extends LumenBaseNode {
  type: 'mathInline';
  tex: string;
}

export interface LumenMathBlockNode extends LumenBaseNode {
  type: 'mathBlock';
  tex: string;
}

export type MathEnvKind = MathEnvType;

export interface LumenMathEnvironmentNode extends LumenBaseNode {
  type: 'mathEnvironment';
  envKind: MathEnvType;
  id?: string;
  title?: string;
  status?: MathStatus;
  dependsOn?: string[];
  proves?: string[];
  number?: string;
  unnumbered?: boolean;
  of?: string;
  access?: string;
  attributes?: Record<string, unknown>;
  children: LumenNode[];
}

export interface LumenSmartRefNode extends LumenBaseNode {
  type: 'smartRef';
  domain: string;
  target: string;
  symbol?: string;
  package?: string;
  raw: string;
  children?: LumenNode[];
}

export type AdmonitionKind = 'note' | 'tip' | 'warning' | 'danger' | 'info' | 'caution';

export interface LumenAdmonitionNode extends LumenBaseNode {
  type: 'admonition';
  kind: AdmonitionKind;
  title?: string;
  access?: string;
  attributes?: Record<string, unknown>;
  children: LumenNode[];
}

export interface LumenTabsNode extends LumenBaseNode {
  type: 'tabs';
  syncKey?: string;
  access?: string;
  attributes?: Record<string, unknown>;
  children: LumenTabItemNode[];
}

export interface LumenTabItemNode extends LumenBaseNode {
  type: 'tabItem';
  label: string;
  value?: string;
  access?: string;
  attributes?: Record<string, unknown>;
  children: LumenNode[];
}

export interface LumenDiagramNode extends LumenBaseNode {
  type: 'diagram';
  engine: string;
  code: string;
  elk?: boolean;
  title?: string;
}

export interface LumenJsxWidgetNode extends LumenBaseNode {
  type: 'jsxWidget';
  name: string;
  props: Record<string, unknown>;
  isSelfClosing: boolean;
  children?: LumenNode[];
}

export interface LumenRawHtmlPlaceholderNode extends LumenBaseNode {
  type: 'rawHtmlPlaceholder';
  raw: string;
}

export interface LumenRawNode extends LumenBaseNode {
  type: 'raw';
  value: string;
}

export type LumenNode =
  | LumenRootNode
  | LumenParagraphNode
  | LumenHeadingNode
  | LumenTextNode
  | LumenInlineCodeNode
  | LumenCodeBlockNode
  | LumenMathInlineNode
  | LumenMathBlockNode
  | LumenMathEnvironmentNode
  | LumenSmartRefNode
  | LumenAdmonitionNode
  | LumenTabsNode
  | LumenTabItemNode
  | LumenDiagramNode
  | LumenJsxWidgetNode
  | LumenRawHtmlPlaceholderNode
  | LumenRawNode
  | LumenBaseNode;

export interface LumenTocItem {
  id: string;
  title: string;
  level: number;
  access?: string;
  children?: LumenTocItem[];
}

export type LumenTocEntry = LumenTocItem;

export interface LumenDocumentAst {
  frontmatter: LumenFrontmatter;
  children: LumenNode[];
  toc: LumenTocItem[];
  diagnostics: LumenDiagnostic[];
  rawContent?: string;
}

export interface LumenDocument {
  id: string;
  title: string;
  filePath?: string;
  frontmatter: LumenFrontmatter;
  content: string;
  ast: LumenDocumentAst;
}
