import React from 'react';
import clsx from 'clsx';

export interface LumenNavbarItem {
  label: string;
  to?: string;
  href?: string;
  active?: boolean;
  external?: boolean;
  items?: LumenNavbarItem[];
}

export interface LumenNavbarProps {
  title?: string;
  logo?: { src: string; alt?: string; href?: string };
  items?: LumenNavbarItem[];
  versions?: string[];
  currentVersion?: string;
  onVersionChange?: (version: string) => void;
  locales?: string[];
  currentLocale?: string;
  onLocaleChange?: (locale: string) => void;
  theme?: 'light' | 'dark' | 'system' | string;
  onThemeToggle?: () => void;
  onSearchClick?: () => void;
  className?: string;
}

function renderNavbarItems(items: LumenNavbarItem[]): React.JSX.Element[] {
  return items.map((item, idx) => {
    if (item.items && item.items.length > 0) {
      return (
        <div key={idx} className="lumen-navbar-dropdown">
          <span className="lumen-navbar-dropdown-label">{item.label}</span>
          <div className="lumen-navbar-dropdown-menu">{renderNavbarItems(item.items)}</div>
        </div>
      );
    }
    return (
      <a
        key={idx}
        href={item.to || item.href || '#'}
        className={clsx('lumen-navbar-link', item.active && 'active')}
        target={item.external ? '_blank' : undefined}
        rel={item.external ? 'noopener noreferrer' : undefined}
      >
        {item.label}
      </a>
    );
  });
}

export function LumenNavbar({
  title = 'Lumen Documentation',
  logo,
  items = [],
  versions,
  currentVersion,
  onVersionChange,
  locales,
  currentLocale,
  onLocaleChange,
  theme,
  onThemeToggle,
  onSearchClick,
  className,
}: LumenNavbarProps): React.JSX.Element {
  return (
    <nav className={clsx('lumen-navbar', className)} aria-label="Main navigation">
      <div className="lumen-navbar-brand">
        {logo?.src && (
          <a href={logo.href || '/'} className="lumen-navbar-logo-link">
            <img src={logo.src} alt={logo.alt || title || ''} className="lumen-navbar-logo" />
          </a>
        )}
        {title !== undefined && <span className="lumen-navbar-title">{title}</span>}
      </div>

      <div className="lumen-navbar-items">{renderNavbarItems(items)}</div>

      {onSearchClick ? (
        <button type="button" onClick={onSearchClick} className="lumen-navbar-search-btn">
          Search
        </button>
      ) : null}

      <div className="lumen-navbar-controls">
        {versions && versions.length > 0 && (
          <select
            className="lumen-navbar-version-select"
            value={currentVersion}
            onChange={(e) => onVersionChange?.(e.target.value)}
            aria-label="Select documentation version"
          >
            {versions.map((ver) => (
              <option key={ver} value={ver}>
                {ver}
              </option>
            ))}
          </select>
        )}
        {locales && locales.length > 0 && (
          <select
            className="lumen-navbar-locale-select"
            value={currentLocale}
            onChange={(e) => onLocaleChange?.(e.target.value)}
            aria-label="Select language"
          >
            {locales.map((loc) => (
              <option key={loc} value={loc}>
                {loc}
              </option>
            ))}
          </select>
        )}
        {onThemeToggle && (
          <button
            type="button"
            className="lumen-navbar-theme-btn"
            onClick={onThemeToggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀' : '☾'}
          </button>
        )}
      </div>
    </nav>
  );
}
