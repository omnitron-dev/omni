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
export interface TabsProps extends Omit<ComponentProps<typeof MuiTabs>, 'onChange' | 'value'> {
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

  return (
    <Box sx={{ width: '100%' }}>
      <MuiTabs value={value} onChange={handleChange} {...muiProps}>
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
      {tabItems.map((tab) => {
        const isActive = tab.value === value;
        if (!isActive && !keepMounted) return null;

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
