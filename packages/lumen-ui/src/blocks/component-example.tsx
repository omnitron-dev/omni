import React, { useId, useState, type ReactNode } from 'react';
import { useIsClient } from '@omnitron-dev/prism/core';
import { Alert, Box, IconButton, Tooltip, Typography } from '@omnitron-dev/prism/ui';
import { ErrorBoundary } from '@omnitron-dev/prism/components/error-boundary';
import { ChevronDownIcon, RefreshIcon } from '@omnitron-dev/prism/icons';
import { CodeBlock, type CodeBlockProps } from './code-block.js';

export interface ComponentExampleProps {
  title: string;
  /** The build-time source of the trusted component supplied as children. */
  code: string;
  children: ReactNode;
  language?: string;
  resettable?: boolean;
  labels?: { source?: string; reset?: string } & CodeBlockProps['labels'];
}

/** One preview frame with a native source disclosure; readable before hydration. */
export function ComponentExample({
  title, code, children, language = 'tsx', resettable = false, labels,
}: ComponentExampleProps): React.JSX.Element {
  const captionId = useId();
  const interactive = useIsClient();
  const [generation, setGeneration] = useState(0);
  const resetLabel = labels?.reset ?? 'Reset example';

  return <Box component="figure" data-example="" aria-labelledby={captionId} sx={{
    m: 0, my: 2, minWidth: 0, maxWidth: '100%', border: 1, borderColor: 'divider', borderRadius: 1,
    bgcolor: 'background.paper',
  }}>
    <Box component="figcaption" sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1,
      minHeight: 48, boxSizing: 'border-box', borderBottom: 1, borderColor: 'divider',
    }}>
      <Typography component="span" variant="subtitle2" id={captionId} sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{title}</Typography>
      {resettable && <Box sx={{ width: 32, height: 32, flexShrink: 0 }}>
        {interactive && <Tooltip title={resetLabel}>
          <IconButton type="button" size="small" aria-label={resetLabel} onClick={() => setGeneration(value => value + 1)}
            sx={{ width: 32, height: 32, '&.Mui-focusVisible': { outline: '2px solid currentColor', outlineOffset: 2 } }}>
            <RefreshIcon fontSize="small" />
          </IconButton>
        </Tooltip>}
      </Box>}
    </Box>
    <Box className="lumen-example-preview" sx={{ p: 2, minWidth: 0, overflowX: 'auto' }}>
      <ErrorBoundary key={generation} fallback={({ error }) => <Alert severity="error">{error.message}</Alert>}>
        {children}
      </ErrorBoundary>
    </Box>
    <Box component="details" sx={{
      minWidth: 0, borderTop: 1, borderColor: 'divider',
      '& > summary': { display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, cursor: 'pointer', typography: 'body2', listStyle: 'none' },
      '& > summary::-webkit-details-marker': { display: 'none' },
      '& > summary:focus-visible': { outline: '2px solid currentColor', outlineOffset: -2, borderRadius: 1 },
      '& > summary:hover': { bgcolor: 'action.hover' },
      '&[open] > summary svg': { transform: 'rotate(180deg)' },
      '& .lumen-code-frame': { borderRadius: 0, border: 0, borderTop: 1, borderColor: 'divider' },
      '& .lumen-code-block': { maxHeight: '24rem' },
    }}>
      <summary><ChevronDownIcon fontSize="small" /><span>{labels?.source ?? 'Source code'}</span></summary>
      <CodeBlock code={code} language={language} copyable={interactive} labels={labels} />
    </Box>
  </Box>;
}
