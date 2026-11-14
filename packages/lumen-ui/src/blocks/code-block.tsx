import React from 'react';
import clsx from 'clsx';
import { Box, IconButton, Tooltip } from '@omnitron-dev/prism/ui';
import { CheckIcon, CopyIcon, ErrorIcon } from '@omnitron-dev/prism/icons';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';
import { useIntersectionObserver } from '@omnitron-dev/prism/hooks';
import type { HighlightedSource } from '@omnitron-dev/lumen-ast/highlight';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  copyable?: boolean;
  className?: string;
  labels?: { copy?: string; copied?: string; copyFailed?: string; highlightUnavailable?: string };
}

const hiddenStatus = {
  position: 'absolute', width: '1px', height: '1px', p: 0, m: '-1px',
  overflow: 'hidden', clip: 'rect(0, 0, 0, 0)', whiteSpace: 'nowrap', border: 0,
} as const;

function CopyCode({ code, labels }: Pick<CodeBlockProps, 'labels'> & { code: string }): React.JSX.Element {
  const { state, copy, reset } = useCopyToClipboard();
  React.useEffect(reset, [code, reset]);
  const copyLabel = labels?.copy ?? 'Copy code';
  const message = state === 'success' ? labels?.copied ?? 'Code copied'
    : state === 'error' ? labels?.copyFailed ?? 'Copy failed. Select the code and copy it manually.' : '';
  const Icon = state === 'success' ? CheckIcon : state === 'error' ? ErrorIcon : CopyIcon;
  return <Box className="lumen-code-copy" sx={{ position: 'absolute', insetBlockStart: 4, insetInlineEnd: 4, zIndex: 1 }}>
    <Tooltip title={message || copyLabel}>
      <IconButton size="small" aria-label={copyLabel} onClick={() => { void copy(code); }}
        color={state === 'error' ? 'error' : state === 'success' ? 'success' : 'default'}
        sx={{ width: 32, height: 32, bgcolor: 'background.paper', border: 1, borderColor: 'divider',
          '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: 2 } }}>
        <Icon fontSize="small" />
      </IconButton>
    </Tooltip>
    <Box component="span" role="status" aria-live="polite" aria-atomic="true" sx={hiddenStatus}>{message}</Box>
  </Box>;
}

/** Literal SSR source, progressively highlighted with one lazily loaded grammar. */
export function CodeBlock({ code = '', language = 'ts', copyable = false, className, labels }: CodeBlockProps): React.JSX.Element {
  const { ref, isIntersecting } = useIntersectionObserver({ triggerOnce: true });
  const [result, setResult] = React.useState<{
    code: string; language: string; source?: HighlightedSource; failed?: boolean;
  }>();
  React.useEffect(() => {
    let current = true;
    if (code && isIntersecting) {
      void import('@omnitron-dev/lumen-ast/highlight')
        .then(({ highlightCode }) => highlightCode(code, language))
        .then(source => { if (current) setResult({ code, language, source }); })
        .catch(() => { if (current) setResult({ code, language, failed: true }); });
    }
    return () => { current = false; };
  }, [code, language, isIntersecting]);
  const active = result?.code === code && result.language === language ? result : undefined;
  const source = active?.source;
  const highlighted = source?.highlighted;
  return <Box className="lumen-code-frame" sx={{
    position: 'relative', minWidth: 0, maxWidth: '100%', border: 1, borderColor: 'divider', borderRadius: 1, bgcolor: 'background.neutral',
  }}>
    <Box sx={{ height: 40, display: 'flex', alignItems: 'center', px: 2, color: 'text.secondary',
      fontSize: '0.75rem', fontFamily: 'var(--lumen-font-mono, ui-monospace, monospace)' }}>
      <Box component="span" title={language} sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', mr: 5 }}>{language}</Box>
      {copyable && <CopyCode code={code} labels={labels} />}
    </Box>
    <Box component="pre" ref={ref} tabIndex={code ? 0 : undefined}
      className={clsx(`lumen-code-block language-${language}`, className)}
      data-highlight={active?.failed ? 'error' : highlighted ? 'ready' : source || !code ? 'plain' : isIntersecting ? 'loading' : 'idle'}
      sx={theme => ({
        m: 0, boxSizing: 'border-box', maxWidth: '100%', overflow: 'auto',
        '&.lumen-code-block': { p: 2, border: 0, borderRadius: 'inherit' },
        fontFamily: 'var(--lumen-font-mono, ui-monospace, monospace)', fontSize: 'var(--lumen-code-font-size, 0.875rem)', lineHeight: 1.65,
        bgcolor: 'transparent',
        '& > code': { font: 'inherit', background: 'transparent', padding: 0, border: 0 },
        '& > code span[style]': {
          color: `var(--shiki-${theme.palette.mode}, inherit)`,
          fontStyle: `var(--shiki-${theme.palette.mode}-font-style, normal)`,
          fontWeight: `var(--shiki-${theme.palette.mode}-font-weight, inherit)`,
          textDecoration: `var(--shiki-${theme.palette.mode}-text-decoration, none)`,
        },
      })}>
      <code className={clsx(highlighted && 'shiki', `language-${language}`)}>{source
        ? source.lines.map((line, lineIndex) => <React.Fragment key={lineIndex}>
          {line.tokens.map((token, tokenIndex) => <span key={tokenIndex} style={token.style}>{token.content}</span>)}{line.ending}
        </React.Fragment>) : code}</code>
    </Box>
    {active?.failed && <Box component="span" role="status" sx={{ display: 'block', fontSize: '0.75rem', color: 'text.secondary', mt: 0.5 }}>
      {labels?.highlightUnavailable ?? 'Syntax highlighting is unavailable. The complete source is still shown.'}
    </Box>}
  </Box>;
}
