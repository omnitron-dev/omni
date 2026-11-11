import React, { type ReactNode } from 'react';
import clsx from 'clsx';

export type MathEnvironmentType =
  | 'axiom'
  | 'definition'
  | 'theorem'
  | 'lemma'
  | 'proposition'
  | 'corollary'
  | 'proof'
  | 'remark'
  | 'example'
  | 'hypothesis';

export interface MathTheoremBlockProps {
  id: string;
  title?: string;
  envType?: MathEnvironmentType;
  status?: string;
  number?: string;
  dependsOn?: string[];
  proves?: string[];
  children?: ReactNode;
  className?: string;
}

export function MathTheoremBlock({
  id,
  title,
  envType = 'theorem',
  status,
  number,
  dependsOn,
  proves,
  children,
  className,
}: MathTheoremBlockProps): React.JSX.Element {
  const upperType = envType.toUpperCase();
  const isProof = envType === 'proof';

  return (
    <section id={id} className={clsx('lumen-math-block', `lumen-math-${envType}`, className)} data-status={status}>
      <header className="lumen-math-header">
        <span className="lumen-math-type">{upperType}</span>
        {number && <span className="lumen-math-number">{number}</span>}
        {title ? <span className="lumen-math-title">{title}</span> : null}
        <a href={`#${id}`} className="lumen-math-id">
          #{id}
        </a>
      </header>
      <div className="lumen-math-body">
        {children}
        {isProof && (
          <span className="lumen-math-qed" aria-label="End of proof">
            ∎
          </span>
        )}
      </div>
    </section>
  );
}
