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
import { createContext, useContext, provideContext } from '../core/component/context.js';
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
  children?: any | (() => any);
  /** Additional props */
  [key: string]: any;
}

export interface TimelineItemProps {
  /** Item status */
  status?: TimelineItemStatus;
  /** Children */
  children?: any | (() => any);
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
  /** Item status - reactive getter */
  status: () => TimelineItemStatus;
}

// ============================================================================
// Contexts
// ============================================================================

const TimelineContext = createContext<TimelineContextValue | null>(null);

const useTimelineContext = (): TimelineContextValue => {
  const context = useContext(TimelineContext);
  // Graceful degradation: return default context if not found
  if (!context) {
    return {
      orientation: 'vertical', // Default orientation
    };
  }
  return context;
};

const TimelineItemContext = createContext<TimelineItemContextValue | null>(null);

const useTimelineItemContext = (): TimelineItemContextValue => {
  const context = useContext(TimelineItemContext);
  // Graceful degradation: return default context if not found
  if (!context) {
    return {
      status: () => 'pending', // Default status
    };
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

  // Provide context before return
  provideContext(TimelineContext, contextValue);

  return () => {
    const { children: childrenProp, ...rest } = props;
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    return jsx('div', {
      'data-timeline': '',
      'data-orientation': orientation,
      role: 'list',
      ...rest,
      children,
    });
  };
});

// ============================================================================
// Timeline Item
// ============================================================================

export const TimelineItem = defineComponent<TimelineItemProps>((props) => {
  const timeline = useTimelineContext();

  const contextValue: TimelineItemContextValue = {
    status: () => props.status ?? 'pending',
  };

  // Provide context before return
  provideContext(TimelineItemContext, contextValue);

  return () => {
    const { children: childrenProp, ...rest } = props;
    const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

    // Evaluate reactive status in render function
    const status = contextValue.status();

    return jsx('div', {
      'data-timeline-item': '',
      'data-status': status,
      'data-orientation': timeline.orientation,
      role: 'listitem',
      ...rest,
      children,
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

    // Evaluate reactive status in render function
    const status = item.status();

    return jsx('div', {
      'data-timeline-marker': '',
      'data-status': status,
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

    // Evaluate reactive status in render function
    const status = item.status();

    return jsx('div', {
      'data-timeline-connector': '',
      'data-status': status,
      'aria-hidden': 'true',
      ...rest,
    });
  };
});

// ============================================================================
// Timeline Content
// ============================================================================

export const TimelineContent = defineComponent<TimelineContentProps>((props) => () => {
  const { children: childrenProp, ...rest } = props;

  // Evaluate function children
  const children = typeof childrenProp === 'function' ? childrenProp() : childrenProp;

  return jsx('div', {
    'data-timeline-content': '',
    ...rest,
    children,
  });
});

// ============================================================================
// Timeline Title
// ============================================================================

export const TimelineTitle = defineComponent<TimelineTitleProps>((props) => () => {
  const { children, ...rest } = props;

  return jsx('h4', {
    'data-timeline-title': '',
    ...rest,
    children,
  });
});

// ============================================================================
// Timeline Description
// ============================================================================

export const TimelineDescription = defineComponent<TimelineDescriptionProps>((props) => () => {
  const { children, ...rest } = props;

  return jsx('p', {
    'data-timeline-description': '',
    ...rest,
    children,
  });
});

// ============================================================================
// Timeline Timestamp
// ============================================================================

export const TimelineTimestamp = defineComponent<TimelineTimestampProps>((props) => () => {
  const { children, ...rest } = props;

  return jsx('time', {
    'data-timeline-timestamp': '',
    ...rest,
    children,
  });
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
