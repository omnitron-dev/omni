import React, { type ReactNode } from 'react';
import clsx from 'clsx';

export interface DocLayoutProps {
  sidebar?: ReactNode;
  sectionNav?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function DocLayout({ sidebar, sectionNav, children, className }: DocLayoutProps): React.JSX.Element {
  return (
    <div className={clsx('lumen-doc-layout', className)}>
      {sidebar && <aside className="lumen-doc-sidebar">{sidebar}</aside>}
      <main className="lumen-doc-main">{children}</main>
      {sectionNav && <div className="lumen-doc-toc">{sectionNav}</div>}
    </div>
  );
}
