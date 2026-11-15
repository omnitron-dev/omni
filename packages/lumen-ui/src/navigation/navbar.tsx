import React, { useId, useState } from 'react';
import clsx from 'clsx';
import { Box, Button, IconButton, Link, Menu, MenuItem, Stack, TextField, Typography } from '@omnitron-dev/prism/ui';
import { ChevronDownIcon, SearchIcon, ThemeModeIcon } from '@omnitron-dev/prism/icons';

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

function menuItems(items: LumenNavbarItem[], onClose: () => void, group = ''): React.ReactNode[] {
  return items.flatMap((item, index) => {
    const key = `${group}/${index}`;
    if (item.items?.length) return [
      <MenuItem key={key} disabled role="presentation">{item.label}</MenuItem>,
      ...menuItems(item.items, onClose, key),
    ];
    const href = item.to || item.href;
    return <MenuItem key={key} component="a" href={href} disabled={!href} selected={item.active}
      aria-current={item.active ? 'page' : undefined} onClick={onClose}
      target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
      {item.label}
    </MenuItem>;
  });
}

function NavbarItem({ item }: { item: LumenNavbarItem }): React.JSX.Element {
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  if (item.items?.length) return <>
    <Button id={`${id}-trigger`} type="button" color="inherit" endIcon={<ChevronDownIcon />}
      aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? id : undefined}
      onClick={event => setAnchor(event.currentTarget)}>{item.label}</Button>
    <Menu id={id} anchorEl={anchor} open={Boolean(anchor)} onClose={() => setAnchor(null)}
      slotProps={{ list: { 'aria-labelledby': `${id}-trigger` } }}>
      {menuItems(item.items, () => setAnchor(null))}
    </Menu>
  </>;
  const href = item.to || item.href;
  if (!href) return <Button disabled>{item.label}</Button>;
  return <Button href={href} color="inherit" aria-current={item.active ? 'page' : undefined}
    target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
    {item.label}
  </Button>;
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
    <Box component="nav" className={clsx('lumen-navbar', className)} aria-label="Main navigation"
      sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} className="lumen-navbar-brand">
        {logo?.src && <Link href={logo.href || '/'} className="lumen-navbar-logo-link">
          <img src={logo.src} alt={logo.alt || title || ''} className="lumen-navbar-logo" />
        </Link>}
        {title !== undefined && <Typography component="span" variant="subtitle1">{title}</Typography>}
      </Stack>
      <Stack direction="row" sx={{ flexWrap: 'wrap' }} className="lumen-navbar-items">
        {items.map((item, index) => <NavbarItem key={index} item={item} />)}
      </Stack>
      {onSearchClick && <Button type="button" onClick={onSearchClick} startIcon={<SearchIcon />}>Search</Button>}
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }} className="lumen-navbar-controls">
        {versions && versions.length > 0 && <TextField select size="small" label="Documentation version"
          value={currentVersion ?? versions[0]} disabled={!onVersionChange}
          onChange={event => onVersionChange?.(event.target.value)}>
          {versions.map(version => <MenuItem key={version} value={version}>{version}</MenuItem>)}
        </TextField>}
        {locales && locales.length > 0 && <TextField select size="small" label="Language"
          value={currentLocale ?? locales[0]} disabled={!onLocaleChange}
          onChange={event => onLocaleChange?.(event.target.value)}>
          {locales.map(locale => <MenuItem key={locale} value={locale}>{locale}</MenuItem>)}
        </TextField>}
        {onThemeToggle && <IconButton type="button" onClick={onThemeToggle}
          aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
          <ThemeModeIcon mode={theme === 'dark' ? 'light' : 'dark'} />
        </IconButton>}
      </Stack>
    </Box>
  );
}
