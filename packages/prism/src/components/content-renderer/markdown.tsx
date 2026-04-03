'use client';

import './code-highlight.css';

import type { Options } from 'react-markdown';
import { useId, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

import Link from '@mui/material/Link';
import type { SxProps, Theme } from '@mui/material/styles';

import { ContentRoot } from './styles.js';
import { contentClasses } from './classes.js';
import { htmlToMarkdown, isMarkdownContent } from './html-to-markdown.js';
import { remarkSpoiler } from './remark-spoiler.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type MarkdownProps = {
  /** Markdown or HTML string content */
  children: string;
  /** Additional CSS class */
  className?: string;
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Compact mode for chat messages, comments, etc. */
  compact?: boolean;
  /** Custom react-markdown component overrides */
  components?: Options['components'];
  /** Additional rehype plugins */
  rehypePlugins?: Options['rehypePlugins'];
  /** Additional remark plugins */
  remarkPlugins?: Options['remarkPlugins'];
  /** Link component for internal navigation (e.g. react-router Link) */
  routerLinkComponent?: React.ElementType;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isExternalLink(href: string): boolean {
  return /^https?:\/\//.test(href) || href.startsWith('//');
}

// ---------------------------------------------------------------------------
// Default plugins
// ---------------------------------------------------------------------------

const defaultRehypePlugins: NonNullable<Options['rehypePlugins']> = [rehypeRaw, rehypeHighlight];

const defaultRemarkPlugins: NonNullable<Options['remarkPlugins']> = [
  [remarkGfm, { singleTilde: false }],
  remarkSpoiler,
];

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Markdown({
  children,
  className,
  sx,
  compact,
  components,
  rehypePlugins,
  remarkPlugins,
  routerLinkComponent,
}: MarkdownProps) {
  const content = useMemo(() => {
    const cleaned = String(children).trim();
    return isMarkdownContent(cleaned) ? cleaned : htmlToMarkdown(cleaned);
  }, [children]);

  const allRehypePlugins = useMemo(() => [...defaultRehypePlugins, ...(rehypePlugins ?? [])], [rehypePlugins]);

  const allRemarkPlugins = useMemo(() => [...defaultRemarkPlugins, ...(remarkPlugins ?? [])], [remarkPlugins]);

  const defaultComponents = useMemo(
    (): NonNullable<Options['components']> => ({
      img: ({ node: _n, ...other }) => <img className={contentClasses.image} {...other} />,
      a: ({ href = '', children: linkChildren, node: _n, ...other }) => {
        if (isExternalLink(href)) {
          return (
            <Link href={href} target="_blank" rel="noopener noreferrer" className={contentClasses.link} {...other}>
              {linkChildren}
            </Link>
          );
        }
        if (routerLinkComponent) {
          return (
            <Link component={routerLinkComponent} href={href} className={contentClasses.link} {...other}>
              {linkChildren}
            </Link>
          );
        }
        return (
          <Link href={href} className={contentClasses.link} {...other}>
            {linkChildren}
          </Link>
        );
      },
      pre: ({ children: preChildren }) => (
        <div className={contentClasses.codeBlock}>
          <pre>{preChildren}</pre>
        </div>
      ),
      code: ({ className: codeClassName = '', children: codeChildren, node: _n, ...other }) => {
        const hasLanguage = /language-\w+/.test(codeClassName);
        return (
          <code className={hasLanguage ? codeClassName : contentClasses.codeInline} {...other}>
            {codeChildren}
          </code>
        );
      },
      input: ({ type, node: _n, ...other }) =>
        type === 'checkbox' ? (
          <CheckboxInput className={contentClasses.checkbox} {...other} />
        ) : (
          <input type={type} {...other} />
        ),
    }),
    [routerLinkComponent]
  );

  return (
    <ContentRoot
      className={[contentClasses.root, contentClasses.markdown, compact && contentClasses.compact, className]
        .filter(Boolean)
        .join(' ')}
      sx={sx}
    >
      <ReactMarkdown
        components={{ ...defaultComponents, ...components }}
        rehypePlugins={allRehypePlugins}
        remarkPlugins={allRemarkPlugins}
      >
        {content}
      </ReactMarkdown>
    </ContentRoot>
  );
}

function CheckboxInput(props: React.ComponentProps<'input'>) {
  const uniqueId = useId();
  return <input type="checkbox" id={uniqueId} {...props} />;
}
