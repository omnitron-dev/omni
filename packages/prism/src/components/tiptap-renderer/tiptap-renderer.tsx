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
// URL safety (XSS hardening, T#347)
// ---------------------------------------------------------------------------
//
// Every URL that lands in an `href`, `src`, or other navigable attribute
// MUST be schema-validated. Cookie-mode auth makes any rendered
// javascript:/data:/vbscript:/blob: URI catastrophic — an attacker who
// crafts a TipTap document with a `link` mark or `image` node carrying
// a `javascript:alert(...)` href gets full session control on click.
// These guards are intentionally conservative: anything that isn't
// unambiguously a same-origin path or an http(s) URL collapses to a
// safe sentinel (`#` for links, undefined for image src so the <img>
// renders nothing rather than load a hostile resource).

function isSafeHref(url: unknown): url is string {
  if (typeof url !== 'string' || url.length === 0) return false;
  // Written as escapes, not as the literal bytes: the source used to hold
  // real control characters, so this read as `/[ -]/` — "a space or a
  // dash" — in every editor and diff. What it actually rejects is the
  // C0 range plus DEL, which is what makes `java\tscript:` and friends
  // parse as `javascript:` in some URL parsers.
  // eslint-disable-next-line no-control-regex -- rejecting control characters is the point
  if (/[\x00-\x1f\x7f]/.test(url)) return false;
  if (url !== url.trim() || url.includes('\\') || url.startsWith('//')) return false;
  if (url.startsWith('#')) return true;
  if (url.startsWith('/') && !url.startsWith('//') && !url.startsWith('/\\')) return true;
  const lower = url.toLowerCase().trimStart();
  if (lower.startsWith('http://') || lower.startsWith('https://')) return true;
  // A path relative to the source document is useful for corpus navigation.
  // A scheme (including unknown schemes) or network-path authority is not a relative path.
  return !/^[a-z][a-z0-9+.-]*:/i.test(url);
}

/** Return the URL if safe to interpolate into href/src; otherwise undefined. */
export function sanitizeHref(url: unknown): string | undefined {
  return isSafeHref(url) ? (url as string) : undefined;
}

/**
 * Restrictive iframe-src validator for embed nodes (youtube et al.).
 * Accepts only https://www.youtube.com / https://www.youtube-nocookie.com.
 * Anything else collapses to undefined so the iframe doesn't render.
 */
function sanitizeEmbedSrc(url: unknown): string | undefined {
  if (typeof url !== 'string') return undefined;
  if (!isSafeHref(url)) return undefined;
  const lower = url.toLowerCase();
  if (lower.startsWith('https://www.youtube.com/') || lower.startsWith('https://www.youtube-nocookie.com/')) {
    return url;
  }
  return undefined;
}

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

export type CustomNodeRenderer = ComponentType<{ node: TipTapNode }>;
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
  nodeRenderers?: Readonly<Record<string, CustomNodeRenderer>>;
  inheritRegisteredNodes?: boolean;
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
      case 'link': {
        // T#347 — href is attacker-controlled (post author chose it).
        // sanitizeHref rejects javascript:/data:/vbscript:/etc. — falls
        // back to `#` so the link is inert rather than dangerous.
        const safeHref = sanitizeHref(mark.attrs?.href) ?? '#';
        // Same-origin paths route through the host app's Link (router-
        // aware) so cross-doc navigation doesn't full-reload. External
        // http(s) URLs keep <a target="_blank"> behaviour.
        const Link = ctx?.linkComponent;
        if (Link && safeHref.startsWith('/') && !safeHref.startsWith('//')) {
          return (
            <Link to={safeHref} className={contentClasses.link}>
              {acc}
            </Link>
          );
        }
        return (
          <a href={safeHref} target={mark.attrs?.target ?? '_blank'} rel="noopener noreferrer">
            {acc}
          </a>
        );
      }
      case 'internalLink': {
        const to = sanitizeHref(mark.attrs?.to ?? mark.attrs?.href) ?? '#';
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
  // T#347 — XSS hardening: the prior implementation read `node.attrs.html`
  // and injected it via dangerouslySetInnerHTML on the premise that it was
  // "Shiki-rendered HTML pre-sanitised at build time". That premise is
  // false in the portal context: `node.attrs` come from a TipTap document
  // authored at runtime by an arbitrary user. An attacker who can post a
  // codeBlock could set `attrs.html` to a script-carrying payload and
  // achieve stored XSS. We drop the html-attr path entirely; if syntax
  // highlighting is needed, the consumer can pass a custom CodeBlock via
  // the customNodeRegistry that highlights from the trusted text content.
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
      }
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
      <pre>
        <code className={language ? `language-${language}` : undefined}>{code}</code>
      </pre>
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
  return <ScopedNode key={index} node={node} index={index} />;
}
function ScopedNode({ node, index }: { node: TipTapNode; index: number }): ReactNode {
  const context = useContext(TipTapContext);
  const CustomRenderer =
    context.nodeRenderers?.[node.type] ??
    (context.inheritRegisteredNodes !== false ? customNodeRegistry.get(node.type) : undefined);
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

    case 'image': {
      // T#347 — XSS hardening: image src in a TipTap doc is post-author
      // controlled. A `data:text/html` URL would let the browser load
      // a script-bearing document under the portal's origin. Reject
      // anything that isn't a same-origin path or http(s) URL — the
      // image silently doesn't render if the src is unsafe.
      const safeSrc = sanitizeHref(node.attrs?.src);
      if (!safeSrc) return null;
      return (
        <img
          key={index}
          src={safeSrc}
          alt={node.attrs?.alt ?? ''}
          title={node.attrs?.title}
          className={contentClasses.image}
          loading="lazy"
        />
      );
    }

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
          <table>
            <tbody>{node.content?.map(renderNode)}</tbody>
          </table>
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
      // T#347 — XSS hardening: iframes are powerful (can frame any URL
      // the host allows X-Frame'ing). Restrict src to the YouTube
      // origins we actually want — anything else collapses to null
      // and the iframe doesn't render. Without this, a post author
      // could embed an arbitrary attacker-controlled page in an
      // iframe with autoplay + fullscreen permissions.
      const safeSrc = sanitizeEmbedSrc(node.attrs?.src);
      if (!safeSrc) return null;
      return (
        <div key={index} style={{ position: 'relative', paddingBottom: '56.25%', height: 0, marginBottom: '1.25rem' }}>
          <iframe
            src={safeSrc}
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
  nodeRenderers?: Readonly<Record<string, CustomNodeRenderer>>;
  inheritRegisteredNodes?: boolean;
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

export function TipTapRenderer({
  content,
  className,
  sx,
  compact,
  linkComponent,
  nodeRenderers,
  inheritRegisteredNodes,
}: TipTapRendererProps) {
  if (!content || !('content' in content) || !Array.isArray(content.content)) {
    return null;
  }

  const ctxValue: TipTapRenderContext = { linkComponent, nodeRenderers, inheritRegisteredNodes };

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
