'use client';

/**
 * Tabs Component
 *
 * Tabbed interface with panel support.
 *
 * @module @omnitron-dev/prism/components/tabs
 */

import type { ReactNode, ReactElement, SyntheticEvent, ComponentProps } from 'react';
import { useState, useCallback, Children, isValidElement, useMemo } from 'react';
import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';
import Box from '@mui/material/Box';

/**
 * Tab item definition.
 */
export interface TabItem {
  /** Unique value for the tab */
  value: string;
  /** Tab label */
  label: string;
  /** Optional icon (must be a React element, not arbitrary ReactNode) */
  icon?: ReactElement;
  /** Tab content */
  content?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * Props for Tabs component.
 */
// `action` clashes with MUI's imperative `action: Ref<TabsActions>` —
// we're not exposing the imperative ref API (it's almost never used
// in app code) and reclaim the name for the actions slot instead.
export interface TabsProps extends Omit<ComponentProps<typeof MuiTabs>, 'onChange' | 'value' | 'action'> {
  /** Tab items configuration */
  tabs?: TabItem[];
  /** Controlled value */
  value?: string;
  /** Default value (uncontrolled) */
  defaultValue?: string;
  /** Change handler */
  onChange?: (value: string) => void;
  /** Tab panel children (alternative to tabs prop) */
  children?: ReactNode;
  /** Keep unmounted tabs in DOM */
  keepMounted?: boolean;
  /**
   * Optional actions area rendered to the right of the tab strip
   * (e.g. a primary "Create" button). Mirrors the action slot on
   * `Breadcrumbs`. When set, the tab strip's bottom border moves
   * onto the surrounding flex row so the divider runs full-width
   * past the action area without breaking.
   */
  action?: ReactNode;
}

/**
 * Tabs - Tabbed interface component.
 *
 * @example
 * ```tsx
 * // Using tabs prop
 * <Tabs
 *   tabs={[
 *     { value: 'tab1', label: 'General', content: <GeneralSettings /> },
 *     { value: 'tab2', label: 'Security', content: <SecuritySettings /> },
 *     { value: 'tab3', label: 'Notifications', content: <NotificationSettings /> },
 *   ]}
 *   defaultValue="tab1"
 * />
 *
 * // Using children
 * <Tabs defaultValue="overview">
 *   <TabPanel value="overview" label="Overview">
 *     Overview content
 *   </TabPanel>
 *   <TabPanel value="details" label="Details">
 *     Details content
 *   </TabPanel>
 * </Tabs>
 * ```
 */
export function Tabs({
  tabs,
  value: controlledValue,
  defaultValue,
  onChange,
  children,
  keepMounted = false,
  action,
  ...muiProps
}: TabsProps): ReactNode {
  const [internalValue, setInternalValue] = useState(defaultValue ?? tabs?.[0]?.value ?? '');

  const value = controlledValue ?? internalValue;

  const handleChange = useCallback(
    (_event: SyntheticEvent, newValue: string) => {
      if (controlledValue === undefined) {
        setInternalValue(newValue);
      }
      onChange?.(newValue);
    },
    [controlledValue, onChange]
  );

  // Extract tab items from children if using TabPanel pattern
  const tabItems = useMemo(() => {
    if (tabs) return tabs;

    const items: TabItem[] = [];
    Children.forEach(children, (child) => {
      if (isValidElement(child) && child.type === TabPanel) {
        const props = child.props as TabPanelProps;
        items.push({
          value: props.value,
          label: props.label ?? props.value,
          icon: props.icon,
          content: props.children,
          disabled: props.disabled,
        });
      }
    });
    return items;
  }, [tabs, children]);

  // When an action is present, the bottom-border-of-tabs role
  // shifts from `MuiTabs` to the surrounding flex row, so the
  // divider line spans the full width past the action area
  // (matches the breadcrumbs heading-row treatment). Without an
  // action the wrapper is transparent and `MuiTabs` keeps drawing
  // its own indicator track as before.
  const hasAction = action !== undefined && action !== null && action !== false;

  return (
    <Box sx={{ width: '100%' }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-end',
          justifyContent: 'space-between',
          gap: 2,
          ...(hasAction && {
            borderBottom: 1,
            borderColor: 'divider',
          }),
        }}
      >
        <MuiTabs
          value={value}
          onChange={handleChange}
          {...muiProps}
          sx={{
            // Suppress MuiTabs' own bottom border when the
            // wrapper owns the divider — otherwise we'd get a
            // double line under the tab strip.
            ...(hasAction && {
              minHeight: 'auto',
              '& .MuiTabs-flexContainer': { gap: 0 },
            }),
            ...muiProps.sx,
          }}
        >
          {tabItems.map((tab) => (
            <MuiTab
              key={tab.value}
              value={tab.value}
              label={tab.label}
              icon={tab.icon}
              iconPosition="start"
              disabled={tab.disabled}
            />
          ))}
        </MuiTabs>
        {hasAction && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
              // Sit the action visually on the tab baseline so
              // the underline runs cleanly underneath; a small
              // bottom inset keeps a 44px-tall button from
              // crowding the divider.
              pb: 1,
            }}
          >
            {action}
          </Box>
        )}
      </Box>
      {tabItems.map((tab) => {
        const isActive = tab.value === value;
        if (!isActive && !keepMounted) return null;
        // Strip-only usage (`tabs` entries without `content`):
        // the page renders its own content below the tabs and
        // just needs the navigation strip. Skipping the panel
        // box keeps the layout flush.
        if (tab.content === undefined) return null;

        return (
          <Box
            key={tab.value}
            role="tabpanel"
            hidden={!isActive}
            id={`tabpanel-${tab.value}`}
            aria-labelledby={`tab-${tab.value}`}
            sx={{ pt: 2 }}
          >
            {tab.content}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * Props for TabPanel component.
 */
export interface TabPanelProps {
  /** Unique value (must match Tabs value) */
  value: string;
  /** Tab label */
  label?: string;
  /** Optional icon (must be a React element, not arbitrary ReactNode) */
  icon?: ReactElement;
  /** Panel content */
  children?: ReactNode;
  /** Disabled state */
  disabled?: boolean;
}

/**
 * TabPanel - Individual tab panel for use with Tabs children pattern.
 *
 * @example
 * ```tsx
 * <Tabs defaultValue="tab1">
 *   <TabPanel value="tab1" label="First">
 *     First panel content
 *   </TabPanel>
 *   <TabPanel value="tab2" label="Second">
 *     Second panel content
 *   </TabPanel>
 * </Tabs>
 * ```
 */
export function TabPanel({ children }: TabPanelProps): ReactNode {
  // This component is only used for configuration extraction
  // The actual rendering happens in the Tabs component
  return <>{children}</>;
}

/**
 * Hook for managing tab state externally.
 */
export interface UseTabsOptions {
  /** Initial tab value */
  defaultValue?: string;
  /** Callback when tab changes */
  onChange?: (value: string) => void;
}

export interface UseTabsReturn {
  /** Current tab value */
  value: string;
  /** Set the active tab */
  setValue: (value: string) => void;
  /** Props to spread on Tabs component */
  tabsProps: {
    value: string;
    onChange: (value: string) => void;
  };
}

/**
 * useTabs - Hook for external tab state management.
 *
 * Uses proper memoization to prevent unnecessary re-renders.
 *
 * @example
 * ```tsx
 * const { tabsProps, value, setValue } = useTabs({ defaultValue: 'tab1' });
 *
 * return (
 *   <>
 *     <button onClick={() => setValue('tab2')}>Go to Tab 2</button>
 *     <Tabs {...tabsProps} tabs={tabs} />
 *   </>
 * );
 * ```
 */
export function useTabs({ defaultValue = '', onChange }: UseTabsOptions = {}): UseTabsReturn {
  const [value, setValueInternal] = useState(defaultValue);

  const setValue = useCallback(
    (newValue: string) => {
      setValueInternal(newValue);
      onChange?.(newValue);
    },
    [onChange]
  );

  // Memoize the return value to prevent unnecessary re-renders
  return useMemo(
    () => ({
      value,
      setValue,
      tabsProps: {
        value,
        onChange: setValue,
      },
    }),
    [value, setValue]
  );
}
