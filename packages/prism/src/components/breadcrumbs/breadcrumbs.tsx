'use client';

/**
 * Custom Breadcrumbs Component
 *
 * Full-featured navigation breadcrumbs with heading, back link, action slot,
 * and more links section. Adapted from minimal-vite-ts patterns.
 *
 * @module @omnitron/prism/components/breadcrumbs
 */

import type { ReactNode, ElementType } from 'react';
import { styled } from '@mui/material/styles';
import MuiBreadcrumbs from '@mui/material/Breadcrumbs';
import Link from '@mui/material/Link';
import SvgIcon from '@mui/material/SvgIcon';
import type { SxProps, Theme } from '@mui/material/styles';
import type { BreadcrumbsProps as MuiBreadcrumbsProps } from '@mui/material/Breadcrumbs';

// =============================================================================
// TYPES
// =============================================================================

/** Individual breadcrumb link definition. */
export interface BreadcrumbLinkProps {
  /** Link label */
  name?: string;
  /** Link href */
  href?: string;
  /** Link icon */
  icon?: ReactNode;
  /** Whether the link is disabled */
  disabled?: boolean;
}

/** Props for the MoreLinks sub-component. */
export interface MoreLinksProps extends React.ComponentProps<'ul'> {
  /** Array of external link URLs */
  links?: string[];
  /** MUI sx prop */
  sx?: SxProps<Theme>;
}

/** Slot props for customizing sub-components. */
export interface BreadcrumbsSlotProps {
  breadcrumbs?: Partial<MuiBreadcrumbsProps>;
  heading?: React.ComponentProps<'h6'>;
  content?: React.ComponentProps<'div'>;
  container?: React.ComponentProps<'div'>;
  moreLinks?: Omit<MoreLinksProps, 'links'>;
}

/** Custom slot overrides. */
export interface BreadcrumbsSlots {
  /** Override the entire breadcrumbs section */
  breadcrumbs?: ReactNode;
}

/** Props for the Breadcrumbs component. */
export interface BreadcrumbsProps extends React.ComponentProps<'div'> {
  /** MUI sx prop */
  sx?: SxProps<Theme>;
  /** Page heading displayed above breadcrumbs */
  heading?: string;
  /** Keep the last breadcrumb link active (clickable) */
  activeLast?: boolean;
  /** Back navigation href — displays arrow icon before heading */
  backHref?: string;
  /** Action element rendered on the right side */
  action?: ReactNode;
  /** Breadcrumb link items */
  links?: BreadcrumbLinkProps[];
  /** External reference links displayed below breadcrumbs */
  moreLinks?: string[];
  /**
   * Custom link component for client-side routing (e.g. react-router's Link).
   * The component receives `to` (from href) and `children` props.
   * When provided, breadcrumb links use this instead of native `<a>` tags.
   */
  linkComponent?: ElementType;
  /** Slot overrides */
  slots?: BreadcrumbsSlots;
  /** Slot prop overrides */
  slotProps?: Partial<BreadcrumbsSlotProps>;
}

// =============================================================================
// STYLED COMPONENTS
// =============================================================================

const BreadcrumbsRoot = styled('div')(({ theme }) => ({
  display: 'flex',
  flexDirection: 'column',
  gap: theme.spacing(2),
}));

const BreadcrumbsHeading = styled('h6')(({ theme }) => ({
  ...theme.typography.h4,
  margin: 0,
  padding: 0,
  display: 'inline-flex',
}));

const BreadcrumbsContainer = styled('div')(({ theme }) => ({
  display: 'flex',
  flexWrap: 'wrap',
  gap: theme.spacing(2),
  alignItems: 'flex-start',
  justifyContent: 'flex-end',
}));

const BreadcrumbsContent = styled('div')(({ theme }) => ({
  display: 'flex',
  flex: '1 1 auto',
  gap: theme.spacing(2),
  flexDirection: 'column',
}));

const BreadcrumbsSeparator = styled('span')(({ theme }) => ({
  width: 4,
  height: 4,
  borderRadius: '50%',
  backgroundColor: theme.palette.text.disabled,
}));

const ItemRoot = styled('div', {
  shouldForwardProp: (prop: string) => prop !== 'disabled',
})<{ disabled?: boolean }>(({ disabled, theme }) => ({
  ...theme.typography.body2,
  alignItems: 'center',
  gap: theme.spacing(0.5),
  display: 'inline-flex',
  color: theme.palette.text.primary,
  ...(disabled && {
    cursor: 'default',
    pointerEvents: 'none',
    color: theme.palette.text.disabled,
  }),
}));

const ItemIcon = styled('span')({
  display: 'inherit',
  '& > :first-of-type:not(style):not(:first-of-type ~ *)': {
    width: 20,
    height: 20,
  },
});

const MoreLinksRoot = styled('ul')({
  display: 'flex',
  flexDirection: 'column',
  '& > li': { display: 'flex' },
});

// =============================================================================
// ARROW BACK ICON
// =============================================================================

function ArrowBackIcon() {
  return (
    <SvgIcon sx={{ fontSize: 18 }}>
      <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" />
    </SvgIcon>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/** Back link with arrow icon for navigation. */
function BackLink({
  href,
  label,
  sx,
  linkComponent,
}: {
  href: string;
  label?: string;
  sx?: SxProps<Theme>;
  linkComponent?: ElementType;
}) {
  const linkProps = linkComponent ? { component: linkComponent, to: href } : { href };

  return (
    <Link
      color="inherit"
      underline="none"
      sx={[
        (theme) => ({
          verticalAlign: 'middle',
          display: 'inline-flex',
          alignItems: 'center',
          '& .PrismBackLinkIcon': {
            verticalAlign: 'inherit',
            transform: 'translateY(-1px)',
            ml: { xs: '-14px', md: '-18px' },
            transition: theme.transitions.create('opacity', {
              duration: theme.transitions.duration.shorter,
            }),
          },
          '&:hover .PrismBackLinkIcon': { opacity: 0.48 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
      {...linkProps}
    >
      <span className="PrismBackLinkIcon">
        <ArrowBackIcon />
      </span>
      {label}
    </Link>
  );
}

/** Individual breadcrumb link with optional icon. */
function BreadcrumbLink({
  href,
  icon,
  name,
  disabled,
  linkComponent,
}: BreadcrumbLinkProps & { linkComponent?: ElementType }) {
  const content = (
    <ItemRoot disabled={disabled}>
      {icon && <ItemIcon>{icon}</ItemIcon>}
      {name}
    </ItemRoot>
  );

  if (href && !disabled) {
    const linkProps = linkComponent ? { component: linkComponent, to: href } : { href };

    return (
      <Link color="inherit" sx={{ display: 'inline-flex' }} {...linkProps}>
        {content}
      </Link>
    );
  }

  return content;
}

/** List of external reference links. */
function MoreLinks({ links, sx, ...other }: MoreLinksProps) {
  return (
    <MoreLinksRoot sx={sx} {...other}>
      {links?.map((href) => (
        <li key={href}>
          <Link href={href} variant="body2" target="_blank" rel="noopener noreferrer">
            {href}
          </Link>
        </li>
      ))}
    </MoreLinksRoot>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Breadcrumbs - Full-featured navigation breadcrumbs with heading, back link,
 * action slot, and more links section.
 *
 * @example
 * ```tsx
 * // Simple usage
 * <Breadcrumbs
 *   heading="Product List"
 *   links={[
 *     { name: 'Home', href: '/' },
 *     { name: 'Products', href: '/products' },
 *     { name: 'Electronics' },
 *   ]}
 * />
 *
 * // With back link and action
 * <Breadcrumbs
 *   heading="Edit Product"
 *   backHref="/products"
 *   action={<Button variant="contained">Save</Button>}
 *   links={[
 *     { name: 'Home', href: '/' },
 *     { name: 'Products', href: '/products' },
 *     { name: 'Edit' },
 *   ]}
 * />
 * ```
 */
export function Breadcrumbs({
  sx,
  action,
  backHref,
  heading,
  slots = {},
  links = [],
  moreLinks = [],
  slotProps = {},
  activeLast = false,
  linkComponent,
  ...other
}: BreadcrumbsProps): ReactNode {
  const lastLink = links[links.length - 1]?.name;

  const renderHeading = () => (
    <BreadcrumbsHeading {...slotProps?.heading}>
      {backHref ? <BackLink href={backHref} label={heading} linkComponent={linkComponent} /> : heading}
    </BreadcrumbsHeading>
  );

  const renderLinks = () =>
    slots?.breadcrumbs ?? (
      <MuiBreadcrumbs separator={<BreadcrumbsSeparator />} {...slotProps?.breadcrumbs}>
        {links.map((link, index) => (
          <BreadcrumbLink
            key={link.name ?? index}
            icon={link.icon}
            href={link.href}
            name={link.name}
            disabled={link.name === lastLink && !activeLast}
            linkComponent={linkComponent}
          />
        ))}
      </MuiBreadcrumbs>
    );

  const renderMoreLinks = () => <MoreLinks links={moreLinks} {...slotProps?.moreLinks} />;

  return (
    <BreadcrumbsRoot sx={sx} {...other}>
      <BreadcrumbsContainer {...slotProps?.container}>
        <BreadcrumbsContent {...slotProps?.content}>
          {(heading || backHref) && renderHeading()}
          {(!!links.length || slots?.breadcrumbs) && renderLinks()}
        </BreadcrumbsContent>
        {action}
      </BreadcrumbsContainer>

      {!!moreLinks?.length && renderMoreLinks()}
    </BreadcrumbsRoot>
  );
}
