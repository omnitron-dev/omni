import React, { Fragment, useId, useState, type ReactNode } from 'react';
import { useIsClient } from '@omnitron-dev/prism/core';
import { Box, Button, Typography } from '@omnitron-dev/prism/ui';
import { CodeBlock } from './code-block.js';

export interface ComponentExampleProps {
  title: string;
  /** The build-time source of the trusted component supplied as children. */
  code: string;
  children: ReactNode;
  language?: string;
  resettable?: boolean;
  labels?: { source?: string; reset?: string };
}

/** A rendered example and its exact source, both present in the server HTML. */
export function ComponentExample({
  title, code, children, language = 'tsx', resettable = false, labels,
}: ComponentExampleProps): React.JSX.Element {
  const captionId = useId();
  const interactive = useIsClient();
  const [generation, setGeneration] = useState(0);

  return <Box component="figure" aria-labelledby={captionId} sx={{
    m: 0, my: 2, minWidth: 0, border: 1, borderColor: 'divider', borderRadius: 1,
  }}>
    <Box component="figcaption" sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, px: 2, py: 1,
    }}>
      <Typography component="span" variant="subtitle2" id={captionId}>{title}</Typography>
      {resettable && interactive && <Button type="button" size="small" onClick={() => setGeneration(value => value + 1)}>
        {labels?.reset ?? 'Reset example'}
      </Button>}
    </Box>
    <Box sx={{ px: 2, pb: 2, minWidth: 0 }}>
      <Fragment key={generation}>{children}</Fragment>
    </Box>
    <Box component="details" sx={{
      minWidth: 0, borderTop: 1, borderColor: 'divider',
      '& > summary': { px: 2, py: 1, cursor: 'pointer', typography: 'body2' },
      '& > summary:focus-visible': { outline: '2px solid currentColor', outlineOffset: -2 },
      '& pre': { maxWidth: '100%', maxHeight: '24rem', overflow: 'auto' },
    }}>
      <summary>{labels?.source ?? 'Source code'}</summary>
      <CodeBlock code={code} language={language} copyable={interactive} />
    </Box>
  </Box>;
}
