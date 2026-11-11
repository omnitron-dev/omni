import React from 'react';
import clsx from 'clsx';

export interface PageAgentActionsProps {
  path: string;
  className?: string;
}

export function PageAgentActions({ path, className }: PageAgentActionsProps): React.JSX.Element {
  return (
    <div className={clsx('lumen-page-agent-actions', className)} data-path={path}>
      <a href={`${path}.md`}>View Clean Markdown</a>
    </div>
  );
}
