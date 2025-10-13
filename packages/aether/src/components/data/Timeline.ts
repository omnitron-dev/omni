/**
 * Timeline Component (Styled)
 *
 * A styled timeline component for displaying chronological events:
 * - Vertical and horizontal orientations
 * - Status-based color variants
 * - Size variants
 * - Marker and connector styling
 */

import { styled } from '../../styling/styled.js';
import {
  Timeline as TimelinePrimitive,
  TimelineItem as TimelineItemPrimitive,
  TimelineMarker as TimelineMarkerPrimitive,
  TimelineConnector as TimelineConnectorPrimitive,
  TimelineContent as TimelineContentPrimitive,
  TimelineTitle as TimelineTitlePrimitive,
  TimelineDescription as TimelineDescriptionPrimitive,
  TimelineTimestamp as TimelineTimestampPrimitive,
  type TimelineProps as TimelinePrimitiveProps,
  type TimelineItemProps,
  type TimelineMarkerProps,
  type TimelineConnectorProps,
  type TimelineContentProps,
  type TimelineTitleProps,
  type TimelineDescriptionProps,
  type TimelineTimestampProps,
} from '../../primitives/Timeline.js';

// ============================================================================
// Styled Components
// ============================================================================

/**
 * Timeline Root - Styled timeline container
 */
export const Timeline = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  TimelinePrimitiveProps
>(TimelinePrimitive, {
  base: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  variants: {
    size: {
      sm: {
        gap: '0.75rem',
      },
      md: {
        gap: '1rem',
      },
      lg: {
        gap: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Timeline Item - Styled timeline item
 */
export const TimelineItem = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  TimelineItemProps
>(TimelineItemPrimitive, {
  base: {
    display: 'flex',
    gap: '1rem',
    position: 'relative',
  },
  variants: {
    size: {
      sm: {
        gap: '0.75rem',
      },
      md: {
        gap: '1rem',
      },
      lg: {
        gap: '1.5rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Timeline Marker - Styled timeline marker
 */
export const TimelineMarker = styled<
  {
    size?: 'sm' | 'md' | 'lg';
    variant?: 'solid' | 'outline' | 'dot';
    colorScheme?: 'gray' | 'primary' | 'success' | 'warning' | 'danger';
  },
  TimelineMarkerProps
>(TimelineMarkerPrimitive, {
  base: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: '9999px',
    flexShrink: '0',
  },
  variants: {
    size: {
      sm: {
        width: '1.5rem',
        height: '1.5rem',
      },
      md: {
        width: '2rem',
        height: '2rem',
      },
      lg: {
        width: '2.5rem',
        height: '2.5rem',
      },
    },
    variant: {
      solid: {},
      outline: {
        backgroundColor: '#ffffff',
        borderWidth: '2px',
        borderStyle: 'solid',
      },
      dot: {
        width: '0.75rem',
        height: '0.75rem',
      },
    },
    colorScheme: {
      gray: {},
      primary: {},
      success: {},
      warning: {},
      danger: {},
    },
  },
  compoundVariants: [
    // Solid variants
    {
      variant: 'solid',
      colorScheme: 'gray',
      css: {
        backgroundColor: '#6b7280',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'primary',
      css: {
        backgroundColor: '#3b82f6',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'success',
      css: {
        backgroundColor: '#10b981',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'warning',
      css: {
        backgroundColor: '#f59e0b',
      },
    },
    {
      variant: 'solid',
      colorScheme: 'danger',
      css: {
        backgroundColor: '#ef4444',
      },
    },
    // Outline variants
    {
      variant: 'outline',
      colorScheme: 'gray',
      css: {
        borderColor: '#6b7280',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'primary',
      css: {
        borderColor: '#3b82f6',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'success',
      css: {
        borderColor: '#10b981',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'warning',
      css: {
        borderColor: '#f59e0b',
      },
    },
    {
      variant: 'outline',
      colorScheme: 'danger',
      css: {
        borderColor: '#ef4444',
      },
    },
    // Dot variants
    {
      variant: 'dot',
      colorScheme: 'gray',
      css: {
        backgroundColor: '#6b7280',
      },
    },
    {
      variant: 'dot',
      colorScheme: 'primary',
      css: {
        backgroundColor: '#3b82f6',
      },
    },
    {
      variant: 'dot',
      colorScheme: 'success',
      css: {
        backgroundColor: '#10b981',
      },
    },
    {
      variant: 'dot',
      colorScheme: 'warning',
      css: {
        backgroundColor: '#f59e0b',
      },
    },
    {
      variant: 'dot',
      colorScheme: 'danger',
      css: {
        backgroundColor: '#ef4444',
      },
    },
  ],
  defaultVariants: {
    size: 'md',
    variant: 'solid',
    colorScheme: 'primary',
  },
});

/**
 * Timeline Connector - Styled timeline connector line
 */
export const TimelineConnector = styled<
  {
    colorScheme?: 'gray' | 'primary' | 'success' | 'warning' | 'danger';
  },
  TimelineConnectorProps
>(TimelineConnectorPrimitive, {
  base: {
    position: 'absolute',
    left: '1rem',
    top: '2rem',
    bottom: '-1rem',
    width: '2px',
    backgroundColor: '#e5e7eb',
  },
  variants: {
    colorScheme: {
      gray: {
        backgroundColor: '#d1d5db',
      },
      primary: {
        backgroundColor: '#93c5fd',
      },
      success: {
        backgroundColor: '#6ee7b7',
      },
      warning: {
        backgroundColor: '#fcd34d',
      },
      danger: {
        backgroundColor: '#fca5a5',
      },
    },
  },
  defaultVariants: {
    colorScheme: 'gray',
  },
});

/**
 * Timeline Content - Styled timeline content container
 */
export const TimelineContent = styled(TimelineContentPrimitive, {
  base: {
    flex: '1',
    paddingBottom: '1rem',
  },
});

/**
 * Timeline Title - Styled timeline title
 */
export const TimelineTitle = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  TimelineTitleProps
>(TimelineTitlePrimitive, {
  base: {
    fontWeight: '600',
    color: '#111827',
    marginBottom: '0.25rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.875rem',
      },
      md: {
        fontSize: '1rem',
      },
      lg: {
        fontSize: '1.125rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Timeline Description - Styled timeline description
 */
export const TimelineDescription = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  TimelineDescriptionProps
>(TimelineDescriptionPrimitive, {
  base: {
    color: '#6b7280',
    lineHeight: '1.5',
    marginBottom: '0.5rem',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.75rem',
      },
      md: {
        fontSize: '0.875rem',
      },
      lg: {
        fontSize: '1rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

/**
 * Timeline Timestamp - Styled timeline timestamp
 */
export const TimelineTimestamp = styled<
  {
    size?: 'sm' | 'md' | 'lg';
  },
  TimelineTimestampProps
>(TimelineTimestampPrimitive, {
  base: {
    color: '#9ca3af',
    fontWeight: '500',
  },
  variants: {
    size: {
      sm: {
        fontSize: '0.625rem',
      },
      md: {
        fontSize: '0.75rem',
      },
      lg: {
        fontSize: '0.875rem',
      },
    },
  },
  defaultVariants: {
    size: 'md',
  },
});

// ============================================================================
// Attach sub-components
// ============================================================================

(Timeline as any).Item = TimelineItem;
(Timeline as any).Marker = TimelineMarker;
(Timeline as any).Connector = TimelineConnector;
(Timeline as any).Content = TimelineContent;
(Timeline as any).Title = TimelineTitle;
(Timeline as any).Description = TimelineDescription;
(Timeline as any).Timestamp = TimelineTimestamp;

// ============================================================================
// Display names
// ============================================================================

Timeline.displayName = 'Timeline';
TimelineItem.displayName = 'Timeline.Item';
TimelineMarker.displayName = 'Timeline.Marker';
TimelineConnector.displayName = 'Timeline.Connector';
TimelineContent.displayName = 'Timeline.Content';
TimelineTitle.displayName = 'Timeline.Title';
TimelineDescription.displayName = 'Timeline.Description';
TimelineTimestamp.displayName = 'Timeline.Timestamp';

// ============================================================================
// Type exports
// ============================================================================

export type {
  TimelinePrimitiveProps as TimelineProps,
  TimelineItemProps,
  TimelineMarkerProps,
  TimelineConnectorProps,
  TimelineContentProps,
  TimelineTitleProps,
  TimelineDescriptionProps,
  TimelineTimestampProps,
};
