'use client';

import {
  type ReactNode,
  type ComponentType,
  type ElementType,
  Fragment,
  useState,
  useCallback,
  createContext,
  useContext,
} from 'react';
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
// Render context
//
// Lets the host app inject:
//   - `linkComponent`: a router-aware Link (e.g. react-router-dom's Link)
//      used by the `internalLink` mark to avoid full-page reloads.
// ---------------------------------------------------------------------------

interface TipTapRenderContext {
  linkComponent?: ElementType<{ to: string; children?: ReactNode; className?: string }>;
}

const TipTapContext = createContext<TipTapRenderContext>({});

// ---------------------------------------------------------------------------
// Mark rendering
// ---------------------------------------------------------------------------

function renderMarks(text: string, marks: TipTapMark[] = [], ctx?: TipTapRenderContext): ReactNode {
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
      case 'internalLink': {
        const to = String(mark.attrs?.to ?? mark.attrs?.href ?? '#');
        const Link = ctx?.linkComponent;
        return Link ? (
          <Link to={to} className={contentClasses.link}>
            {acc}
          </Link>
        ) : (
          <a href={to}>{acc}</a>
        );
      }
      case 'highlight':
        return <mark style={mark.attrs?.color ? { backgroundColor: mark.attrs.color } : undefined}>{acc}</mark>;
      case 'subscript':
        return <sub>{acc}</sub>;
      case 'superscript':
        return <sup>{acc}</sup>;
      case 'textStyle':
        return <span style={{ color: mark.attrs?.color }}>{acc}</span>;
      case 'kbd':
        return <kbd className={contentClasses.kbd}>{acc}</kbd>;
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
// Code block — pre-rendered HTML support + copy button
// ---------------------------------------------------------------------------

function CodeBlock({ node }: { node: TipTapNode }) {
  const language = node.attrs?.language as string | null | undefined;
  const title = node.attrs?.title as string | undefined;
  const html = node.attrs?.html as string | undefined;
  const code = node.content?.map((n) => n.text ?? '').join('\n') ?? '';
  const [copied, setCopied] = useState(false);

  const onCopy = useCallback(() => {
    navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {
        // Clipboard API unavailable (insecure context). Silently no-op.
      },
    );
  }, [code]);

  return (
    <div className={contentClasses.codeBlock} data-language={language ?? undefined}>
      {(title || language) && (
        <div className={contentClasses.codeBlockTitle}>
          <span>{title ?? language}</span>
          <button type="button" onClick={onCopy} className={contentClasses.codeBlockCopy} aria-label="Copy code">
            {copied ? '✓' : '⧉'}
          </button>
        </div>
      )}
      {html ? (
        // Shiki-rendered HTML is pre-sanitised at build time and contains only
        // <pre>/<code>/<span> tags with style attributes. Safe to inject.
        (<div dangerouslySetInnerHTML={{ __html: html }} />)
      ) : (
        <pre>
          <code className={language ? `language-${language}` : undefined}>{code}</code>
        </pre>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Admonition (callout)
// ---------------------------------------------------------------------------

const ADMONITION_LABEL: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
  danger: 'Danger',
  info: 'Info',
  caution: 'Caution',
};

const ADMONITION_CLASS: Record<string, string> = {
  note: contentClasses.admonitionNote,
  tip: contentClasses.admonitionTip,
  warning: contentClasses.admonitionWarning,
  danger: contentClasses.admonitionDanger,
  info: contentClasses.admonitionInfo,
  caution: contentClasses.admonitionCaution,
};

function Admonition({ node }: { node: TipTapNode }) {
  const kind = String(node.attrs?.kind ?? 'note');
  const title = (node.attrs?.title as string | undefined) ?? ADMONITION_LABEL[kind] ?? kind;
  const variantClass = ADMONITION_CLASS[kind] ?? contentClasses.admonitionNote;
  return (
    <aside className={`${contentClasses.admonition} ${variantClass}`} data-kind={kind}>
      <div className={contentClasses.admonitionTitle}>{title}</div>
      <div className={contentClasses.admonitionContent}>{node.content?.map(renderNode)}</div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------

function Tabs({ node }: { node: TipTapNode }) {
  const items = (node.content ?? []).filter((c) => c.type === 'tabItem');
  const [active, setActive] = useState(0);
  if (items.length === 0) return null;

  const safeActive = Math.min(active, items.length - 1);

  return (
    <div className={contentClasses.tabs}>
      <div className={contentClasses.tabsHeader} role="tablist">
        {items.map((item, i) => {
          const label = item.attrs?.label ?? item.attrs?.value ?? `Tab ${i + 1}`;
          const isActive = i === safeActive;
          return (
            <button
              key={i}
              type="button"
              role="tab"
              aria-selected={isActive}
              className={`${contentClasses.tabsTab} ${isActive ? contentClasses.tabsTabActive : ''}`}
              onClick={() => setActive(i)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <div className={contentClasses.tabsPanel} role="tabpanel">
        {items[safeActive]?.content?.map(renderNode)}
      </div>
    </div>
  );
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
      return <TextNode key={index} node={node} />;

    case 'paragraph':
      return <p key={index}>{node.content?.map(renderNode)}</p>;

    case 'heading': {
      const level = Math.min(Math.max(node.attrs?.level ?? 2, 1), 6);
      const Tag = `h${level}` as 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';
      // Prefer the build-time-supplied id (kept consistent with the engine's
      // slugifyHeading); fall back to runtime slugification for legacy content.
      const id = node.attrs?.id ?? slugify(node.content);
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

    case 'codeBlock':
      return <CodeBlock key={index} node={node} />;

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
          loading="lazy"
        />
      );

    case 'figure':
      return (
        <figure key={index} className={contentClasses.figure}>
          {node.content?.map(renderNode)}
        </figure>
      );

    case 'figcaption':
      return (
        <figcaption key={index} className={contentClasses.figcaption}>
          {node.content?.map(renderNode)}
        </figcaption>
      );

    case 'hardBreak':
      return <br key={index} />;

    // ─── Admonition / Tabs ──────────────────────────────────
    case 'admonition':
      return <Admonition key={index} node={node} />;

    case 'tabs':
      return <Tabs key={index} node={node} />;

    case 'tabItem':
      // tabItem is rendered by Tabs; if it appears outside, fall back to a
      // plain section so the content isn't lost.
      return (
        <section key={index} data-type="tabItem">
          {node.content?.map(renderNode)}
        </section>
      );

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

function TextNode({ node }: { node: TipTapNode }) {
  const ctx = useContext(TipTapContext);
  return <Fragment>{renderMarks(node.text ?? '', node.marks, ctx)}</Fragment>;
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
  /**
   * Component used to render `internalLink` marks. Pass a router-aware
   * component (e.g. `Link` from react-router-dom) to avoid full reloads.
   */
  linkComponent?: ElementType<{ to: string; children?: ReactNode; className?: string }>;
}

export function TipTapRenderer({ content, className, sx, compact, linkComponent }: TipTapRendererProps) {
  if (!content || !('content' in content) || !Array.isArray(content.content)) {
    return null;
  }

  const ctxValue: TipTapRenderContext = linkComponent ? { linkComponent } : {};

  return (
    <TipTapContext.Provider value={ctxValue}>
      <ContentRoot
        className={[contentClasses.root, contentClasses.tiptap, compact && contentClasses.compact, className]
          .filter(Boolean)
          .join(' ')}
        sx={sx}
      >
        {(content as TipTapDoc).content.map(renderNode)}
      </ContentRoot>
    </TipTapContext.Provider>
  );
}
