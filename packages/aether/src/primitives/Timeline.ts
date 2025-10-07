/**
 * Timeline - Timeline/activity feed component
 *
 * Features:
 * - Vertical and horizontal orientations
 * - Item markers (dots, icons, custom)
 * - Connecting lines between items
 * - Item states (pending, active, completed, error)
 * - Custom content for each item
 * - Timestamps support
 * - ARIA support for accessibility
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext } from '../core/component/context.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type TimelineOrientation = 'vertical' | 'horizontal';
export type TimelineItemStatus = 'pending' | 'active' | 'completed' | 'error';

export interface TimelineProps {
  /** Orientation */
  orientation?: TimelineOrientation;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineItemProps {
  /** Item status */
  status?: TimelineItemStatus;
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineMarkerProps {
  /** Children (icon or custom content) */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineConnectorProps {
  /** Additional props */
  [key: string]: any;
}

export interface TimelineContentProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineTitleProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineDescriptionProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

export interface TimelineTimestampProps {
  /** Children */
  children?: any;
  /** Additional props */
  [key: string]: any;
}

interface TimelineContextValue {
  /** Orientation */
  orientation: TimelineOrientation;
}

interface TimelineItemContextValue {
  /** Item status */
  status: TimelineItemStatus;
}

// ============================================================================
// Contexts
// ============================================================================

const TimelineContext = createContext<TimelineContextValue | null>(null);

const useTimelineContext = (): TimelineContextValue => {
  const context = useContext(TimelineContext);
  if (!context) {
    throw new Error('Timeline components must be used within a Timeline');
  }
  return context;
};

const TimelineItemContext = createContext<TimelineItemContextValue | null>(null);

const useTimelineItemContext = (): TimelineItemContextValue => {
  const context = useContext(TimelineItemContext);
  if (!context) {
    throw new Error(
      'Timeline.* components must be used within a Timeline.Item',
    );
  }
  return context;
};

// ============================================================================
// Timeline Root
// ============================================================================

export const Timeline = defineComponent<TimelineProps>((props) => {
  const orientation = props.orientation ?? 'vertical';

  const contextValue: TimelineContextValue = {
    orientation,
  };

  return () => {
    const { children, ...rest } = props;

    return jsx(TimelineContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-timeline': '',
        'data-orientation': orientation,
        role: 'list',
        ...rest,
        children,
      }),
    });
  };
});

// ============================================================================
// Timeline Item
// ============================================================================

export const TimelineItem = defineComponent<TimelineItemProps>((props) => {
  const timeline = useTimelineContext();
  const status = props.status ?? 'pending';

  const contextValue: TimelineItemContextValue = {
    status,
  };

  return () => {
    const { children, ...rest } = props;

    return jsx(TimelineItemContext.Provider, {
      value: contextValue,
      children: jsx('div', {
        'data-timeline-item': '',
        'data-status': status,
        'data-orientation': timeline.orientation,
        role: 'listitem',
        ...rest,
        children,
      }),
    });
  };
});

// ============================================================================
// Timeline Marker
// ============================================================================

export const TimelineMarker = defineComponent<TimelineMarkerProps>((props) => {
  const item = useTimelineItemContext();

  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-timeline-marker': '',
      'data-status': item.status,
      'aria-hidden': 'true',
      ...rest,
      children: children ?? jsx('div', { 'data-timeline-marker-dot': '' }),
    });
  };
});

// ============================================================================
// Timeline Connector
// ============================================================================

export const TimelineConnector = defineComponent<TimelineConnectorProps>((props) => {
  const item = useTimelineItemContext();

  return () => {
    const { ...rest } = props;

    return jsx('div', {
      'data-timeline-connector': '',
      'data-status': item.status,
      'aria-hidden': 'true',
      ...rest,
    });
  };
});

// ============================================================================
// Timeline Content
// ============================================================================

export const TimelineContent = defineComponent<TimelineContentProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('div', {
      'data-timeline-content': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Timeline Title
// ============================================================================

export const TimelineTitle = defineComponent<TimelineTitleProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('h4', {
      'data-timeline-title': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Timeline Description
// ============================================================================

export const TimelineDescription = defineComponent<TimelineDescriptionProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('p', {
      'data-timeline-description': '',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Timeline Timestamp
// ============================================================================

export const TimelineTimestamp = defineComponent<TimelineTimestampProps>((props) => {
  return () => {
    const { children, ...rest } = props;

    return jsx('time', {
      'data-timeline-timestamp': '',
      ...rest,
      children,
    });
  };
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
// Export types
// ============================================================================

export type { TimelineContextValue, TimelineItemContextValue };
