'use client';

import { type ReactNode, type ComponentType, Fragment } from 'react';
import { ContentRoot } from '../content-renderer/styles.js';
import { contentClasses } from '../content-renderer/classes.js';
import type { SxProps, Theme } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TipTapMark {
  type: string;
  attrs?: Record<string, any>;
}

export interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: TipTapMark[];
  attrs?: Record<string, any>;
}

export interface TipTapDoc {
  type: 'doc';
  content: TipTapNode[];
}

// ---------------------------------------------------------------------------
// Custom node registry
// ---------------------------------------------------------------------------

type CustomNodeRenderer = ComponentType<{ node: TipTapNode }>;
const customNodeRegistry = new Map<string, CustomNodeRenderer>();

export function registerTipTapNode(type: string, component: CustomNodeRenderer) {
  customNodeRegistry.set(type, component);
}

// ---------------------------------------------------------------------------
// Mark rendering
// ---------------------------------------------------------------------------

function renderMarks(text: string, marks: TipTapMark[] = []): ReactNode {
  return marks.reduce<ReactNode>((acc, mark) => {
    switch (mark.type) {
      case 'bold':
        return <strong>{acc}</strong>;
      case 'italic':
        return <em>{acc}</em>;
      case 'code':
        return <code className={contentClasses.codeInline}>{acc}</code>;
      case 'underline':
        return <u>{acc}</u>;
      case 'strike':
        return <s>{acc}</s>;
      case 'link':
        return (
          <a href={mark.attrs?.href} target={mark.attrs?.target ?? '_blank'} rel="noopener noreferrer">
            {acc}
          </a>
        );
      case 'highlight':
        return <mark style={mark.attrs?.color ? { backgroundColor: mark.attrs.color } : undefined}>{acc}</mark>;
      case 'subscript':
        return <sub>{acc}</sub>;
      case 'superscript':
        return <sup>{acc}</sup>;
      case 'textStyle':
        return <span style={{ color: mark.attrs?.color }}>{acc}</span>;
      default:
        return acc;
    }
  }, text);
}

// ---------------------------------------------------------------------------
// Slug generation for heading anchors
// ---------------------------------------------------------------------------

function slugify(nodes?: TipTapNode[]): string | undefined {
  if (!nodes) return undefined;
  const text = nodes.map((n) => n.text ?? '').join('');
  if (!text) return undefined;
  return text
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-|-$/g, '');
}

// ---------------------------------------------------------------------------
// Node rendering
// ---------------------------------------------------------------------------

function renderNode(node: TipTapNode, index: number): ReactNode {
  // Custom registry first
  const CustomRenderer = customNodeRegistry.get(node.type);
  if (CustomRenderer) return <CustomRenderer key={index} node={node} />;

  switch (node.type) {
    case 'text':
      return <Fragment key={index}>{renderMarks(node.text ?? '', node.marks)}</Fragment>;

    case 'paragraph':
      return <p key={index}>{node.content?.map(renderNode)}</p>;

    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 2, 1), 6);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      const id = slugify(node.content);
      return (
        <Tag key={index} id={id}>
          {node.content?.map(renderNode)}
        </Tag>
      );
    }

    case 'bulletList':
      return <ul key={index}>{node.content?.map(renderNode)}</ul>;

    case 'orderedList':
      return (
        <ol key={index} start={node.attrs?.start ?? 1}>
          {node.content?.map(renderNode)}
        </ol>
      );

    case 'listItem':
      return <li key={index}>{node.content?.map(renderNode)}</li>;

    case 'taskList':
      return (
        <ul key={index} data-type="taskList">
          {node.content?.map(renderNode)}
        </ul>
      );

    case 'taskItem': {
      const checked = node.attrs?.checked ?? false;
      return (
        <li key={index} data-type="taskItem" data-checked={checked}>
          <label>
            <input type="checkbox" checked={checked} readOnly className={contentClasses.checkbox} />
          </label>
          <div>{node.content?.map(renderNode)}</div>
        </li>
      );
    }

    case 'blockquote':
      return <blockquote key={index}>{node.content?.map(renderNode)}</blockquote>;

    case 'codeBlock': {
      const language = node.attrs?.language;
      const code = node.content?.map((n) => n.text ?? '').join('\n') ?? '';
      return (
        <div key={index} className={contentClasses.codeBlock}>
          <pre>
            <code className={language ? `language-${language}` : undefined}>{code}</code>
          </pre>
        </div>
      );
    }

    case 'horizontalRule':
      return <hr key={index} />;

    case 'image':
      return (
        <img
          key={index}
          src={node.attrs?.src}
          alt={node.attrs?.alt ?? ''}
          title={node.attrs?.title}
          className={contentClasses.image}
        />
      );

    case 'hardBreak':
      return <br key={index} />;

    // ─── Table ──────────────────────────────────────────────
    case 'table':
      return (
        <div key={index} style={{ overflowX: 'auto' }}>
          <table>{node.content?.map(renderNode)}</table>
        </div>
      );

    case 'tableRow':
      return <tr key={index}>{node.content?.map(renderNode)}</tr>;

    case 'tableCell':
      return (
        <td key={index} colSpan={node.attrs?.colspan ?? 1} rowSpan={node.attrs?.rowspan ?? 1}>
          {node.content?.map(renderNode)}
        </td>
      );

    case 'tableHeader':
      return (
        <th key={index} colSpan={node.attrs?.colspan ?? 1} rowSpan={node.attrs?.rowspan ?? 1}>
          {node.content?.map(renderNode)}
        </th>
      );

    // ─── Details / Summary (collapsible) ────────────────────
    case 'details':
      return (
        <details key={index} open={node.attrs?.open}>
          {node.content?.map(renderNode)}
        </details>
      );

    case 'detailsSummary':
      return <summary key={index}>{node.content?.map(renderNode)}</summary>;

    case 'detailsContent':
      return <div key={index}>{node.content?.map(renderNode)}</div>;

    // ─── YouTube embed ──────────────────────────────────────
    case 'youtube': {
      const src = node.attrs?.src;
      if (!src) return null;
      return (
        <div key={index} style={{ position: 'relative', paddingBottom: '56.25%', height: 0, marginBottom: '1.25rem' }}>
          <iframe
            src={src}
            title="YouTube video"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              border: 'none',
              borderRadius: 8,
            }}
          />
        </div>
      );
    }

    default:
      // Fallback: render children if present
      if (node.content) {
        return <Fragment key={index}>{node.content.map(renderNode)}</Fragment>;
      }
      return null;
  }
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface TipTapRendererProps {
  /** TipTap JSON document */
  content: TipTapDoc | Record<string, unknown> | null;
  /** Additional CSS class */
  className?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Compact mode for chat messages, comments, etc. */
  compact?: boolean;
}

export function TipTapRenderer({ content, className, sx, compact }: TipTapRendererProps) {
  if (!content || !('content' in content) || !Array.isArray(content.content)) {
    return null;
  }

  return (
    <ContentRoot
      className={[contentClasses.root, contentClasses.tiptap, compact && contentClasses.compact, className]
        .filter(Boolean)
        .join(' ')}
      sx={sx}
    >
      {(content as TipTapDoc).content.map(renderNode)}
    </ContentRoot>
  );
}
