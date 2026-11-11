import React from 'react';
import clsx from 'clsx';

export interface LumenFooterColumn {
  title?: string;
  items: Array<{ label: string; href?: string; to?: string; external?: boolean }>;
}

export interface LumenFooterBuildMetadata {
  version?: string;
  commit?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface LumenFooterStatus {
  label?: string;
  url?: string;
  operational?: boolean;
}

export interface LumenFooterProps {
  copyright?: string;
  columns?: LumenFooterColumn[];
  buildMetadata?: LumenFooterBuildMetadata;
  status?: LumenFooterStatus;
  className?: string;
}

export function LumenFooter({
  copyright = '© 2026 LuxQuant Omnitron. All rights reserved.',
  columns,
  buildMetadata,
  status,
  className,
}: LumenFooterProps): React.JSX.Element {
  return (
    <footer className={clsx('lumen-footer', className)}>
      {columns && columns.length > 0 && (
        <div className="lumen-footer-columns">
          {columns.map((col, idx) => (
            <div key={idx} className="lumen-footer-column">
              {col.title && <div className="lumen-footer-col-title">{col.title}</div>}
              <ul className="lumen-footer-col-items">
                {col.items.map((item, itemIdx) => (
                  <li key={itemIdx}>
                    <a
                      href={item.to || item.href || '#'}
                      target={item.external ? '_blank' : undefined}
                      rel={item.external ? 'noopener noreferrer' : undefined}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {status && (
        <div className="lumen-footer-status">
          <span className={clsx('lumen-status-indicator', status.operational && 'operational')} />
          {status.url ? <a href={status.url}>{status.label || 'System Operational'}</a> : <span>{status.label}</span>}
        </div>
      )}

      {buildMetadata && (
        <div className="lumen-footer-build">
          {buildMetadata.version && <span className="lumen-build-version">v{buildMetadata.version}</span>}
          {buildMetadata.commit && (
            <span className="lumen-build-commit">({String(buildMetadata.commit).slice(0, 7)})</span>
          )}
        </div>
      )}

      {copyright}
    </footer>
  );
}
