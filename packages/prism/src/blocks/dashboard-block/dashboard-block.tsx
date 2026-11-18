/**
 * Dashboard Block Component
 *
 * Reusable dashboard widget/card block with header, content, and footer slots.
 * Supports loading, error states, and collapsible behavior.
 *
 * @module blocks/dashboard-block
 */

'use client';

import { type ReactNode, createContext, useContext, useMemo, useCallback, useId } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Divider from '@mui/material/Divider';
import Skeleton from '@mui/material/Skeleton';
import Button from '@mui/material/Button';
import { useBoolean } from '../../core/hooks/use-boolean.js';
import { ErrorBoundary } from '../../components/error-boundary/index.js';
import { EmptyContent } from '../../components/empty-content/index.js';
import { ChevronDownIcon } from '../../icons/controls.js';
import type {
  DashboardBlockProps,
  DashboardBlockContextValue,
  DashboardBlockHeaderProps,
  DashboardBlockContentProps,
  DashboardBlockFooterProps,
  DashboardBlockLabels,
  EmptyConfig,
} from './types.js';

// =============================================================================
// CONTEXT
// =============================================================================

/** Stable no-op for non-collapsible blocks */
const collapseNoop = () => {};

/** Stable default: no translated strings, the block's English fallbacks apply */
const NO_LABELS: DashboardBlockLabels = {};

const DashboardBlockContext = createContext<DashboardBlockContextValue | null>(null);

/**
 * Hook to access dashboard block context.
 */
export function useDashboardBlockContext(): DashboardBlockContextValue {
  const context = useContext(DashboardBlockContext);
  if (!context) {
    throw new Error('useDashboardBlockContext must be used within DashboardBlock');
  }
  return context;
}

// =============================================================================
// SIZE CONFIGS
// =============================================================================

const sizeConfig = {
  small: {
    headerPx: 2,
    headerPy: 1.5,
    contentPx: 2,
    contentPy: 1.5,
    titleVariant: 'subtitle1' as const,
    subtitleVariant: 'caption' as const,
  },
  medium: {
    headerPx: 2.5,
    headerPy: 2,
    contentPx: 2.5,
    contentPy: 2,
    titleVariant: 'h6' as const,
    subtitleVariant: 'body2' as const,
  },
  large: {
    headerPx: 3,
    headerPy: 2.5,
    contentPx: 3,
    contentPy: 2.5,
    titleVariant: 'h5' as const,
    subtitleVariant: 'body1' as const,
  },
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

/**
 * Dashboard block header component.
 */
export function DashboardBlockHeader({
  title,
  subtitle,
  icon,
  actions,
  headingComponent = 'h3',
  sx,
}: DashboardBlockHeaderProps): ReactNode {
  const { collapsible, collapsed, toggleCollapse, size, labels, contentId } = useDashboardBlockContext();
  const config = sizeConfig[size];
  const titleId = useId();
  const subtitleId = useId();
  const toggleLabel = collapsed ? labels.expand : labels.collapse;

  const row = {
    display: 'flex',
    alignItems: 'center',
    gap: 1.5,
    minWidth: 0,
    px: config.headerPx,
    py: config.headerPy,
  } as const;
  const label = (
    <>
      {icon && (
        <Box component="span" aria-hidden="true" sx={{ display: 'inline-flex', flexShrink: 0, color: 'primary.main' }}>
          {icon}
        </Box>
      )}
      <Box component={collapsible ? 'span' : 'div'} sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          component={collapsible ? 'span' : headingComponent}
          id={titleId}
          variant={config.titleVariant}
          sx={{
            fontWeight: 600,
            lineHeight: 1.4,
            display: '-webkit-box',
            WebkitBoxOrient: 'vertical',
            WebkitLineClamp: 2,
            overflow: 'hidden',
            overflowWrap: 'anywhere',
          }}
        >
          {title}
        </Typography>
        {subtitle && (
          <Typography
            component="span"
            id={subtitleId}
            variant={config.subtitleVariant}
            sx={{ display: 'block', color: 'text.secondary', mt: 0.25, overflowWrap: 'anywhere' }}
          >
            {subtitle}
          </Typography>
        )}
      </Box>
    </>
  );

  return (
    <Box
      data-testid="prism-dashboard-block-header"
      sx={[{ display: 'flex', flexWrap: 'wrap', alignItems: 'center' }, ...(Array.isArray(sx) ? sx : [sx])]}
    >
      {collapsible ? (
        <Box
          component={headingComponent}
          aria-labelledby={titleId}
          sx={{ display: 'flex', flex: '1 1 min(100%, 10rem)', alignSelf: 'stretch', minWidth: 0, m: 0 }}
        >
          <ButtonBase
            type="button"
            onClick={toggleCollapse}
            aria-expanded={!collapsed}
            aria-controls={contentId}
            aria-label={toggleLabel}
            aria-labelledby={toggleLabel ? undefined : titleId}
            aria-describedby={subtitle ? subtitleId : undefined}
            data-testid="prism-dashboard-block-collapse"
            sx={{
              ...row,
              width: '100%',
              minHeight: 44,
              textAlign: 'start',
              '@media (hover: hover)': { '&:hover': { bgcolor: 'action.hover' } },
              '&:focus-visible, &.Mui-focusVisible': { outlineOffset: -2 },
            }}
          >
            {label}
            <ChevronDownIcon
              aria-hidden="true"
              fontSize="small"
              sx={{
                flexShrink: 0,
                color: 'text.secondary',
                transform: collapsed ? 'none' : 'rotate(180deg)',
                transition: (theme) =>
                  theme.transitions.create('transform', { duration: theme.transitions.duration.shortest }),
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              }}
            />
          </ButtonBase>
        </Box>
      ) : (
        <Box sx={{ ...row, flex: '1 1 min(100%, 10rem)' }}>{label}</Box>
      )}
      {actions && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            flexWrap: 'wrap',
            gap: 0.5,
            maxWidth: '100%',
            marginInlineStart: 'auto',
            px: config.headerPx,
            py: 0.5,
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  );
}

/**
 * Dashboard block content component.
 */
export function DashboardBlockContent({ children, disablePadding = false, sx }: DashboardBlockContentProps): ReactNode {
  const { size } = useDashboardBlockContext();
  const config = sizeConfig[size];

  return (
    <Box
      data-testid="prism-dashboard-block-content"
      sx={[
        {
          ...(!disablePadding && {
            px: config.contentPx,
            py: config.contentPy,
          }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  );
}

/**
 * Dashboard block footer component.
 */
export function DashboardBlockFooter({ children, divider = true, sx }: DashboardBlockFooterProps): ReactNode {
  const { collapsed, size } = useDashboardBlockContext();
  const config = sizeConfig[size];

  if (collapsed) return null;

  return (
    <>
      {divider && <Divider />}
      <Box
        data-testid="prism-dashboard-block-footer"
        sx={[
          {
            px: config.contentPx,
            py: 1.5,
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {children}
      </Box>
    </>
  );
}

// =============================================================================
// LOADING & ERROR STATES
// =============================================================================

interface LoadingStateProps {
  rows?: number;
  size: 'small' | 'medium' | 'large';
}

function LoadingState({ rows = 3, size }: LoadingStateProps): ReactNode {
  const config = sizeConfig[size];
  return (
    <Box sx={{ px: config.contentPx, py: config.contentPy }}>
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} variant="text" animation="wave" sx={{ height: 20, mb: 1 }} />
      ))}
    </Box>
  );
}

interface ErrorStateProps {
  message?: string | undefined;
  retryLabel?: string | undefined;
  onRetry?: (() => void) | undefined;
  size: 'small' | 'medium' | 'large';
}

function ErrorState({ message = 'Failed to load data', retryLabel = 'Retry', onRetry, size }: ErrorStateProps): ReactNode {
  const config = sizeConfig[size];
  return (
    <Box
      sx={{
        px: config.contentPx,
        py: config.contentPy,
        textAlign: 'center',
      }}
    >
      <Typography color="error" variant="body2" sx={{ mb: onRetry ? 1.5 : 0 }}>
        {message}
      </Typography>
      {onRetry && (
        <Button size="small" onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    </Box>
  );
}

interface EmptyStateProps {
  config: EmptyConfig | undefined;
  size: 'small' | 'medium' | 'large';
}

function EmptyState({ config, size }: EmptyStateProps): ReactNode {
  const pad = sizeConfig[size];
  if (config?.emptyComponent) return config.emptyComponent;
  return (
    <Box data-testid="prism-dashboard-block-empty" sx={{ px: pad.contentPx, py: pad.contentPy }}>
      {/*
       * `compact`: a block is always a card. Without it EmptyContent centres
       * itself in the VIEWPORT (`minHeight: calc(100vh - 240px)`, `flex: 1`),
       * and every empty module on the portal's home page stood about 400 px
       * tall — the page came out 4060 px at 1440×1000, most of it nothing.
       */}
      <EmptyContent
        compact
        icon={config?.icon}
        iconSize={48}
        title={config?.title}
        description={config?.description}
        action={config?.action}
      />
    </Box>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

/**
 * Dashboard Block - Reusable dashboard widget/card.
 *
 * Features:
 * - Header with title, subtitle, icon, and actions
 * - Content area with optional padding
 * - Footer slot with optional divider
 * - Loading and error states
 * - Collapsible behavior (controlled or uncontrolled)
 * - Three size presets (small, medium, large)
 * - Three variants (default, outlined, filled)
 *
 * @example
 * ```tsx
 * <DashboardBlock
 *   title="Revenue Overview"
 *   subtitle="Last 30 days"
 *   icon={<BarChartIcon />}
 *   actions={<IconButton><MoreIcon /></IconButton>}
 *   collapsible
 * >
 *   <RevenueChart />
 * </DashboardBlock>
 * ```
 */
export function DashboardBlock({
  title,
  subtitle,
  icon,
  actions,
  children,
  footer,
  variant = 'default',
  size = 'medium',
  loading = false,
  loadingConfig,
  error = false,
  errorConfig,
  empty = false,
  emptyConfig,
  labels = NO_LABELS,
  catchErrors = true,
  collapsible = false,
  defaultCollapsed = false,
  mountOnEnter = false,
  collapsed: controlledCollapsed,
  onCollapseChange,
  disablePadding = false,
  footerDivider = true,
  sx,
  slotProps,
}: DashboardBlockProps): ReactNode {
  // Collapse state (controlled or uncontrolled)
  const contentId = useId();
  const uncontrolledCollapse = useBoolean(defaultCollapsed);
  const isControlled = controlledCollapsed !== undefined;
  const collapsed = isControlled ? controlledCollapsed : uncontrolledCollapse.value;

  const handleSetCollapsed = useCallback(
    (value: boolean) => {
      if (!collapsible || value === collapsed) return;
      if (!isControlled) uncontrolledCollapse.setValue(value);
      onCollapseChange?.(value);
    },
    [collapsible, collapsed, isControlled, onCollapseChange, uncontrolledCollapse]
  );
  const handleToggleCollapse = useCallback(() => handleSetCollapsed(!collapsed), [collapsed, handleSetCollapsed]);

  // Context value
  const contextValue = useMemo<DashboardBlockContextValue>(
    () => ({
      contentId,
      collapsible,
      collapsed: collapsible ? collapsed : false,
      toggleCollapse: collapsible ? handleToggleCollapse : collapseNoop,
      setCollapsed: collapsible ? handleSetCollapsed : collapseNoop,
      loading,
      error,
      variant,
      size,
      labels,
    }),
    [contentId, collapsed, collapsible, handleToggleCollapse, handleSetCollapsed, loading, error, variant, size, labels]
  );

  const errorMessage = errorConfig?.message ?? labels.error;
  // Loading, then error, then empty, then the content — an error is never
  // drawn as «nothing here».
  const body = loading ? (
    (loadingConfig?.loadingComponent ?? <LoadingState rows={loadingConfig?.skeletonRows ?? 3} size={size} />)
  ) : error ? (
    (errorConfig?.errorComponent ?? (
      <ErrorState message={errorMessage} retryLabel={labels.retry} onRetry={errorConfig?.onRetry} size={size} />
    ))
  ) : empty ? (
    <EmptyState config={emptyConfig} size={size} />
  ) : children ? (
    <DashboardBlockContent disablePadding={disablePadding} {...slotProps?.content}>
      {children}
    </DashboardBlockContent>
  ) : null;

  // Paper variant based on block variant
  const paperVariant = variant === 'outlined' ? 'outlined' : 'elevation';
  const paperElevation = variant === 'default' ? 1 : 0;

  return (
    <DashboardBlockContext.Provider value={contextValue}>
      <Paper
        data-testid="prism-dashboard-block"
        variant={paperVariant}
        elevation={paperElevation}
        sx={[
          {
            overflow: 'hidden',
            ...(variant === 'filled' && {
              bgcolor: 'action.hover',
            }),
          },
          ...(Array.isArray(sx) ? sx : [sx]),
        ]}
      >
        {/* Header */}
        {title && (
          <DashboardBlockHeader
            title={title}
            subtitle={subtitle}
            icon={icon}
            actions={actions}
            {...slotProps?.header}
          />
        )}

        <Box id={contentId} inert={contextValue.collapsed || undefined}>
          <Collapse in={!contextValue.collapsed} timeout="auto" mountOnEnter={mountOnEnter}>
            {title && <Divider />}
            <Box aria-live={loading || error || empty ? 'polite' : 'off'} aria-busy={loading}>
              {catchErrors ? (
                <ErrorBoundary
                  resetKeys={[loading, error, empty]}
                  fallback={({ resetErrorBoundary }) => (
                    <ErrorState
                      message={labels.error}
                      retryLabel={labels.retry}
                      onRetry={() => {
                        resetErrorBoundary();
                        errorConfig?.onRetry?.();
                      }}
                      size={size}
                    />
                  )}
                >
                  {body}
                </ErrorBoundary>
              ) : (
                body
              )}
            </Box>
          </Collapse>

          {/* Footer */}
          {footer && !contextValue.collapsed && !loading && !error && (
            <DashboardBlockFooter divider={footerDivider} {...slotProps?.footer}>
              {footer}
            </DashboardBlockFooter>
          )}
        </Box>
      </Paper>
    </DashboardBlockContext.Provider>
  );
}
