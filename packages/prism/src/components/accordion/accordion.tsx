'use client';

/**
 * Accordion Component
 *
 * Expandable content panels.
 *
 * @module @omnitron/prism/components/accordion
 */

import type { ReactNode, ComponentProps } from 'react';
import { useState, useCallback } from 'react';
import MuiAccordion from '@mui/material/Accordion';
import MuiAccordionSummary from '@mui/material/AccordionSummary';
import MuiAccordionDetails from '@mui/material/AccordionDetails';
import Typography from '@mui/material/Typography';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

/**
 * Accordion item definition.
 */
export interface AccordionItem {
  /** Unique identifier */
  id: string;
  /** Header title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Panel content */
  content: ReactNode;
  /** Disabled state */
  disabled?: boolean;
  /** Optional icon */
  icon?: ReactNode;
}

/**
 * Props for Accordion component.
 */
export interface AccordionProps {
  /** Accordion items */
  items: AccordionItem[];
  /** Allow multiple panels open (default: false for single-open mode) */
  multiple?: boolean;
  /** Default expanded panel(s) */
  defaultExpanded?: string | string[];
  /** Controlled expanded state */
  expanded?: string | string[];
  /** Change handler */
  onChange?: (expanded: string[]) => void;
  /** Accordion variant */
  variant?: 'default' | 'outlined' | 'elevated';
  /** Disable gutter between panels */
  disableGutters?: boolean;
}

/**
 * Accordion - Expandable content panels.
 *
 * @example
 * ```tsx
 * // Single-open mode (default)
 * <Accordion
 *   items={[
 *     { id: 'panel1', title: 'Section 1', content: <Panel1Content /> },
 *     { id: 'panel2', title: 'Section 2', content: <Panel2Content /> },
 *     { id: 'panel3', title: 'Section 3', content: <Panel3Content /> },
 *   ]}
 *   defaultExpanded="panel1"
 * />
 *
 * // Multiple-open mode
 * <Accordion
 *   items={items}
 *   multiple
 *   defaultExpanded={['panel1', 'panel3']}
 * />
 * ```
 */
export function Accordion({
  items,
  multiple = false,
  defaultExpanded,
  expanded: controlledExpanded,
  onChange,
  variant = 'default',
  disableGutters = false,
}: AccordionProps): ReactNode {
  const [internalExpanded, setInternalExpanded] = useState<string[]>(() => {
    if (defaultExpanded === undefined) return [];
    return Array.isArray(defaultExpanded) ? defaultExpanded : [defaultExpanded];
  });

  const expanded =
    controlledExpanded !== undefined
      ? Array.isArray(controlledExpanded)
        ? controlledExpanded
        : [controlledExpanded]
      : internalExpanded;

  const handleChange = useCallback(
    (panelId: string) => (_event: React.SyntheticEvent, isExpanded: boolean) => {
      let newExpanded: string[];

      if (multiple) {
        newExpanded = isExpanded ? [...expanded, panelId] : expanded.filter((id) => id !== panelId);
      } else {
        newExpanded = isExpanded ? [panelId] : [];
      }

      if (controlledExpanded === undefined) {
        setInternalExpanded(newExpanded);
      }
      onChange?.(newExpanded);
    },
    [expanded, multiple, controlledExpanded, onChange]
  );

  const getAccordionSx = (): ComponentProps<typeof MuiAccordion>['sx'] => {
    switch (variant) {
      case 'outlined':
        return {
          border: 1,
          borderColor: 'divider',
          '&:not(:last-child)': { borderBottom: 0 },
          '&::before': { display: 'none' },
          boxShadow: 'none',
        };
      case 'elevated':
        return {
          boxShadow: 2,
          '&::before': { display: 'none' },
          mb: disableGutters ? 0 : 1,
        };
      default:
        return {};
    }
  };

  return (
    <>
      {items.map((item) => (
        <MuiAccordion
          key={item.id}
          expanded={expanded.includes(item.id)}
          onChange={handleChange(item.id)}
          disabled={item.disabled}
          disableGutters={disableGutters}
          sx={getAccordionSx()}
        >
          <MuiAccordionSummary
            expandIcon={<ExpandMoreIcon />}
            aria-controls={`${item.id}-content`}
            id={`${item.id}-header`}
          >
            {item.icon && (
              <Typography component="span" sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
                {item.icon}
              </Typography>
            )}
            <Typography component="span" sx={{ fontWeight: 500 }}>
              {item.title}
            </Typography>
            {item.subtitle && (
              <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
                {item.subtitle}
              </Typography>
            )}
          </MuiAccordionSummary>
          <MuiAccordionDetails>{item.content}</MuiAccordionDetails>
        </MuiAccordion>
      ))}
    </>
  );
}

/**
 * Props for SimpleAccordion component.
 */
export interface SimpleAccordionProps extends Omit<ComponentProps<typeof MuiAccordion>, 'children'> {
  /** Header title */
  title: string;
  /** Optional subtitle */
  subtitle?: string;
  /** Panel content */
  children: ReactNode;
  /** Optional icon */
  icon?: ReactNode;
}

/**
 * SimpleAccordion - Single expandable panel.
 *
 * @example
 * ```tsx
 * <SimpleAccordion title="Advanced Settings" defaultExpanded>
 *   <AdvancedSettings />
 * </SimpleAccordion>
 * ```
 */
export function SimpleAccordion({ title, subtitle, children, icon, ...props }: SimpleAccordionProps): ReactNode {
  return (
    <MuiAccordion {...props}>
      <MuiAccordionSummary expandIcon={<ExpandMoreIcon />}>
        {icon && (
          <Typography component="span" sx={{ mr: 1, display: 'flex', alignItems: 'center' }}>
            {icon}
          </Typography>
        )}
        <Typography component="span" sx={{ fontWeight: 500 }}>
          {title}
        </Typography>
        {subtitle && (
          <Typography component="span" color="text.secondary" sx={{ ml: 1 }}>
            {subtitle}
          </Typography>
        )}
      </MuiAccordionSummary>
      <MuiAccordionDetails>{children}</MuiAccordionDetails>
    </MuiAccordion>
  );
}

/**
 * Hook for managing accordion state externally.
 */
export interface UseAccordionOptions {
  /** Allow multiple panels open */
  multiple?: boolean;
  /** Default expanded panel(s) */
  defaultExpanded?: string | string[];
  /** Callback when expanded panels change */
  onChange?: (expanded: string[]) => void;
}

export interface UseAccordionReturn {
  /** Currently expanded panel(s) */
  expanded: string[];
  /** Check if a panel is expanded */
  isExpanded: (id: string) => boolean;
  /** Toggle a panel */
  toggle: (id: string) => void;
  /** Expand a panel */
  expand: (id: string) => void;
  /** Collapse a panel */
  collapse: (id: string) => void;
  /** Expand all panels */
  expandAll: (ids: string[]) => void;
  /** Collapse all panels */
  collapseAll: () => void;
  /** Props to spread on Accordion component */
  accordionProps: {
    expanded: string[];
    multiple: boolean;
    onChange: (expanded: string[]) => void;
  };
}

/**
 * useAccordion - Hook for external accordion state management.
 *
 * @example
 * ```tsx
 * const { accordionProps, expandAll, collapseAll } = useAccordion({
 *   multiple: true,
 *   defaultExpanded: ['panel1'],
 * });
 *
 * return (
 *   <>
 *     <button onClick={() => expandAll(['panel1', 'panel2', 'panel3'])}>
 *       Expand All
 *     </button>
 *     <button onClick={collapseAll}>Collapse All</button>
 *     <Accordion {...accordionProps} items={items} />
 *   </>
 * );
 * ```
 */
export function useAccordion({
  multiple = false,
  defaultExpanded,
  onChange,
}: UseAccordionOptions = {}): UseAccordionReturn {
  const [expanded, setExpanded] = useState<string[]>(() => {
    if (defaultExpanded === undefined) return [];
    return Array.isArray(defaultExpanded) ? defaultExpanded : [defaultExpanded];
  });

  const isExpanded = useCallback((id: string) => expanded.includes(id), [expanded]);

  const updateExpanded = useCallback(
    (newExpanded: string[]) => {
      setExpanded(newExpanded);
      onChange?.(newExpanded);
    },
    [onChange]
  );

  const toggle = useCallback(
    (id: string) => {
      if (expanded.includes(id)) {
        updateExpanded(expanded.filter((e) => e !== id));
      } else if (multiple) {
        updateExpanded([...expanded, id]);
      } else {
        updateExpanded([id]);
      }
    },
    [expanded, multiple, updateExpanded]
  );

  const expand = useCallback(
    (id: string) => {
      if (!expanded.includes(id)) {
        if (multiple) {
          updateExpanded([...expanded, id]);
        } else {
          updateExpanded([id]);
        }
      }
    },
    [expanded, multiple, updateExpanded]
  );

  const collapse = useCallback(
    (id: string) => {
      updateExpanded(expanded.filter((e) => e !== id));
    },
    [expanded, updateExpanded]
  );

  const expandAll = useCallback(
    (ids: string[]) => {
      if (multiple) {
        updateExpanded(ids);
      } else if (ids.length > 0) {
        updateExpanded([ids[0]]);
      }
    },
    [multiple, updateExpanded]
  );

  const collapseAll = useCallback(() => {
    updateExpanded([]);
  }, [updateExpanded]);

  return {
    expanded,
    isExpanded,
    toggle,
    expand,
    collapse,
    expandAll,
    collapseAll,
    accordionProps: {
      expanded,
      multiple,
      onChange: updateExpanded,
    },
  };
}
