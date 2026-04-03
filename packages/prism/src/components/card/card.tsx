'use client';

/**
 * Card Component
 *
 * Enhanced card component with variants and sections.
 *
 * @module @omnitron/prism/components/card
 */

import type { ReactNode } from 'react';
import { forwardRef } from 'react';
import Box from '@mui/material/Box';
import MuiCard from '@mui/material/Card';
import CardHeader from '@mui/material/CardHeader';
import CardContent from '@mui/material/CardContent';
import CardActions from '@mui/material/CardActions';
import Typography from '@mui/material/Typography';
import Skeleton from '@mui/material/Skeleton';
import { styled, alpha } from '@mui/material/styles';
import type { CardProps as MuiCardProps } from '@mui/material/Card';
import type { SxProps, Theme } from '@mui/material/styles';

// =============================================================================
// TYPES
// =============================================================================

export type CardVariant = 'elevation' | 'outlined' | 'soft';

export interface CardProps extends Omit<MuiCardProps, 'variant' | 'title'> {
  /** Card variant */
  variant?: CardVariant;
  /** Card header title */
  title?: ReactNode;
  /** Card header subtitle */
  subheader?: ReactNode;
  /** Card header action */
  headerAction?: ReactNode;
  /** Card header styles */
  headerSx?: SxProps<Theme>;
  /** Card content styles */
  contentSx?: SxProps<Theme>;
  /** Card actions */
  actions?: ReactNode;
  /** Card actions styles */
  actionsSx?: SxProps<Theme>;
  /** Disable content padding */
  disablePadding?: boolean;
}

// =============================================================================
// STYLED COMPONENT
// =============================================================================

interface StyledCardProps {
  ownerState: {
    variant: CardVariant;
  };
}

const StyledCard = styled(MuiCard, {
  shouldForwardProp: (prop) => prop !== 'ownerState',
})<StyledCardProps>(({ theme, ownerState }) => {
  const { variant } = ownerState;

  const borderRadius = typeof theme.shape.borderRadius === 'number' ? theme.shape.borderRadius : 4;

  const softStyles = {
    border: 'none',
    boxShadow: 'none',
    backgroundColor: alpha(theme.palette.grey[500], 0.08),
  };

  return {
    position: 'relative',
    borderRadius: borderRadius * 2,
    ...(variant === 'soft' && softStyles),
    ...(variant === 'outlined' && {
      boxShadow: 'none',
    }),
  };
});

// =============================================================================
// COMPONENT
// =============================================================================

/**
 * Card - Enhanced card component with variants.
 *
 * @example
 * ```tsx
 * <Card title="Card Title" subheader="Subtitle">
 *   Card content goes here
 * </Card>
 * ```
 *
 * @example
 * ```tsx
 * // Soft variant
 * <Card variant="soft" title="Settings">
 *   <TextField label="Name" />
 * </Card>
 * ```
 *
 * @example
 * ```tsx
 * // With actions
 * <Card
 *   title="Confirm Action"
 *   actions={
 *     <>
 *       <Button>Cancel</Button>
 *       <Button variant="contained">Confirm</Button>
 *     </>
 *   }
 * >
 *   Are you sure you want to proceed?
 * </Card>
 * ```
 */
export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  {
    variant = 'elevation',
    title,
    subheader,
    headerAction,
    headerSx,
    contentSx,
    actions,
    actionsSx,
    disablePadding,
    children,
    sx,
    ...other
  },
  ref
) {
  const ownerState = { variant };

  const hasHeader = title || subheader || headerAction;

  return (
    <StyledCard
      ref={ref}
      ownerState={ownerState}
      variant={variant === 'outlined' ? 'outlined' : 'elevation'}
      sx={sx}
      {...other}
    >
      {hasHeader && <CardHeader title={title} subheader={subheader} action={headerAction} sx={headerSx} />}

      {children && (
        <CardContent
          sx={{
            ...(disablePadding && { p: 0, '&:last-child': { pb: 0 } }),
            ...contentSx,
          }}
        >
          {children}
        </CardContent>
      )}

      {actions && <CardActions sx={actionsSx}>{actions}</CardActions>}
    </StyledCard>
  );
});

// =============================================================================
// CARD SECTION
// =============================================================================

export interface CardSectionProps {
  /** Section title */
  title?: ReactNode;
  /** Section description */
  description?: ReactNode;
  /** Section content */
  children?: ReactNode;
  /** Additional styles */
  sx?: SxProps<Theme>;
}

/**
 * CardSection - A section within a card with title and description.
 *
 * @example
 * ```tsx
 * <Card>
 *   <CardSection title="Personal Information">
 *     <TextField label="Name" />
 *     <TextField label="Email" />
 *   </CardSection>
 *   <CardSection title="Preferences">
 *     <Switch label="Notifications" />
 *   </CardSection>
 * </Card>
 * ```
 */
export function CardSection({ title, description, children, sx }: CardSectionProps): ReactNode {
  return (
    <Box sx={{ mb: 3, ...sx }}>
      {title && (
        <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
          {title}
        </Typography>
      )}
      {description && (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {description}
        </Typography>
      )}
      {children}
    </Box>
  );
}

// =============================================================================
// STAT CARD
// =============================================================================

export interface StatCardProps extends Omit<CardProps, 'children'> {
  /** Stat title */
  label: string;
  /** Stat value */
  value: string | number;
  /** Change percentage */
  change?: number;
  /** Icon */
  icon?: ReactNode;
  /** Color theme */
  color?: 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'info';
  /** Loading state — shows skeletons instead of values */
  loading?: boolean;
  /** Optional subtitle below the value */
  subtitle?: string;
}

/**
 * StatCard - A card for displaying statistics.
 *
 * @example
 * ```tsx
 * <StatCard
 *   label="Total Sales"
 *   value="$24,500"
 *   change={12.5}
 *   icon={<TrendingUpIcon />}
 *   color="success"
 * />
 * ```
 */
export function StatCard({
  label,
  value,
  change,
  icon,
  color = 'primary',
  loading,
  subtitle,
  variant = 'outlined',
  sx,
  ...other
}: StatCardProps): ReactNode {
  const isPositive = change && change > 0;
  const isNegative = change && change < 0;

  return (
    <Card variant={variant} contentSx={{ p: 2, '&:last-child': { pb: 2 } }} sx={sx} {...other}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          {loading ? (
            <>
              <Skeleton width={80} height={16} />
              <Skeleton width={50} height={32} sx={{ mt: 0.5 }} />
            </>
          ) : (
            <>
              <Typography
                variant="caption"
                fontWeight={600}
                color="text.secondary"
                textTransform="uppercase"
                letterSpacing={0.5}
              >
                {label}
              </Typography>
              <Typography variant="h4" fontWeight={700} sx={{ color: `${color}.main`, mt: 0.5 }}>
                {value}
              </Typography>
              {change !== undefined && (
                <Typography
                  variant="caption"
                  fontWeight={500}
                  color={isPositive ? 'success.main' : isNegative ? 'error.main' : 'text.secondary'}
                  sx={{ mt: 0.5, display: 'block' }}
                >
                  {isPositive ? '+' : ''}
                  {change}%
                </Typography>
              )}
              {subtitle && (
                <Typography variant="caption" color="text.secondary">
                  {subtitle}
                </Typography>
              )}
            </>
          )}
        </Box>
        {icon && !loading && <Box sx={{ color: `${color}.main` }}>{icon}</Box>}
      </Box>
    </Card>
  );
}
