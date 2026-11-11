import React from 'react';
import clsx from 'clsx';

export interface CodeBlockProps {
  code?: string;
  language?: string;
  copyable?: boolean;
  className?: string;
}

export function CodeBlock({ code = '', language = 'ts', className }: CodeBlockProps): React.JSX.Element {
  return (
    <pre className={clsx(`lumen-code-block language-${language}`, className)}>
      <code>{code}</code>
    </pre>
  );
}
