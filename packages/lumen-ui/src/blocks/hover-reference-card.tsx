import React, { type ReactNode } from 'react';
import clsx from 'clsx';

export interface HoverReferenceCardProps {
  id: string;
  targetTitle?: string;
  refKind?: 'thm' | 'def' | 'ax' | 'api' | 'doc' | string;
  excerpt?: string;
  children?: ReactNode;
  className?: string;
}

export function HoverReferenceCard({ id, targetTitle, className }: HoverReferenceCardProps): React.JSX.Element {
  return (
    <div className={clsx('lumen-hover-reference-card', className)} data-reference-id={id}>
      {targetTitle ?? id}
    </div>
  );
}
