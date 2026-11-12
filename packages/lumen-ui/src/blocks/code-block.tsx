import React from 'react';
import clsx from 'clsx';
import Button from '@mui/material/Button';
import { useCopyToClipboard } from '@omnitron-dev/prism/core';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  copyable?: boolean;
  className?: string;
}

function CopyCode({ code }: { code: string }): React.JSX.Element {
  const { state, copy, reset } = useCopyToClipboard();
  React.useEffect(reset, [code, reset]);
  return <div className="lumen-code-copy">
    <Button size="small" onClick={() => { void copy(code); }} aria-label="Copy code">Copy</Button>
    {state === 'success' && <span role="status">Copied</span>}
    {state === 'error' && <span role="alert">Copy failed. Select the code and copy it manually.</span>}
  </div>;
}

export function CodeBlock({ code = '', language = 'ts', copyable = false, className }: CodeBlockProps): React.JSX.Element {
  const source = (
    <pre className={clsx(`lumen-code-block language-${language}`, className)}>
      <code>{code}</code>
    </pre>
  );
  return copyable ? <div className="lumen-code-frame"><CopyCode code={code} />{source}</div> : source;
}
