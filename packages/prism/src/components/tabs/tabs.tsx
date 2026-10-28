'use client';

/**
 * Tabs Component
 *
 * Tabbed interface with panel support.
 *
 * @module components/tabs
 */

import type { ReactNode, ReactElement, SyntheticEvent, ComponentProps, KeyboardEvent } from 'react';
import { useState, useCallback, Children, isValidElement, useMemo, useId, useRef, useEffect } from 'react';
import MuiTabs from '@mui/material/Tabs';
import MuiTab from '@mui/material/Tab';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { CloseIcon } from '../../icons/controls.js';

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
  /** Show an individual close control. Requires Tabs.onClose. */
  closable?: boolean;
  /** Disable closing without disabling selection (e.g. during a save). */
  closeDisabled?: boolean;
  /** Localized accessible name for the close control. */
  closeLabel?: string;
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
  /** Request closure. The caller owns confirmation, removal and controlled selection. */
  onClose?: (value: string) => void;
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
  onClose,
  children,
  keepMounted = false,
  action,
  sx,
  ...muiProps
}: TabsProps): ReactNode {
  const [internalValue, setInternalValue] = useState(defaultValue ?? tabs?.[0]?.value ?? '');

  const value = controlledValue ?? internalValue;
  const id = useId();
  const tabRefs = useRef(new Map<string, HTMLElement>());
  const closing = useRef<{ value: string; next?: string } | null>(null);

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
          closable: props.closable,
          closeDisabled: props.closeDisabled,
          closeLabel: props.closeLabel,
        });
      }
    });
    return items;
  }, [tabs, children]);

  const requestClose = (tab: TabItem) => {
    if (!onClose || !tab.closable || tab.disabled || tab.closeDisabled) return;
    const index = tabItems.indexOf(tab);
    const next =
      tabItems.slice(index + 1).find((item) => !item.disabled) ??
      tabItems
        .slice(0, index)
        .reverse()
        .find((item) => !item.disabled);
    closing.current = { value: tab.value, next: next?.value };
    onClose(tab.value);
  };

  // A confirmation may defer or cancel closure. Move focus only after removal.
  useEffect(() => {
    const pending = closing.current;
    if (!pending || tabItems.some((tab) => tab.value === pending.value)) return;
    closing.current = null;
    if (controlledValue === undefined && value === pending.value) {
      setInternalValue(pending.next ?? '');
      if (pending.next) onChange?.(pending.next);
    }
    if (pending.next) tabRefs.current.get(pending.next)?.focus();
  }, [tabItems, controlledValue, value, onChange]);

  // Flex wrapper exists only to host the optional action node to
  // the right of the tab strip — no bottom divider; MuiTabs keeps
  // its own active-tab indicator track and that's the only line
  // we want under the strip.
  const hasAction = action !== undefined && action !== null && action !== false;

  return (
    <Box sx={{ width: '100%', minWidth: 0, flexShrink: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 2,
          minWidth: 0,
        }}
      >
        <MuiTabs
          value={value || false}
          onChange={handleChange}
          {...muiProps}
          sx={[{ flex: 1, minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}
        >
          {tabItems.map((tab) => {
            const closable = Boolean(tab.closable && onClose);
            return (
              <MuiTab
                key={tab.value}
                ref={(element: HTMLElement | null) => {
                  if (element) tabRefs.current.set(tab.value, element);
                  else tabRefs.current.delete(tab.value);
                }}
                component={closable ? 'div' : 'button'}
                id={`${id}-tab-${tab.value}`}
                aria-controls={tab.content === undefined ? undefined : `${id}-panel-${tab.value}`}
                aria-label={tab.label}
                aria-keyshortcuts={closable && !tab.closeDisabled ? 'Delete' : undefined}
                value={tab.value}
                label={
                  closable ? (
                    <Box
                      component="span"
                      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 0, maxWidth: '100%' }}
                    >
                      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {tab.label}
                      </Box>
                      <IconButton
                        component="button"
                        type="button"
                        size="small"
                        tabIndex={-1}
                        aria-label={tab.closeLabel ?? `Close ${tab.label}`}
                        title={tab.closeLabel ?? `Close ${tab.label}`}
                        disabled={tab.disabled || tab.closeDisabled}
                        sx={{ p: 0.25, flexShrink: 0, color: 'text.secondary' }}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          requestClose(tab);
                        }}
                        onKeyDown={(event) => event.stopPropagation()}
                      >
                        <CloseIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Box>
                  ) : (
                    tab.label
                  )
                }
                icon={tab.icon}
                iconPosition="start"
                disabled={tab.disabled}
                onKeyDown={(event: KeyboardEvent<HTMLElement>) => {
                  if (event.key === 'Delete' && closable && !tab.closeDisabled) {
                    event.preventDefault();
                    event.stopPropagation();
                    requestClose(tab);
                  }
                }}
              />
            );
          })}
        </MuiTabs>
        {hasAction && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              flexShrink: 0,
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
            id={`${id}-panel-${tab.value}`}
            aria-labelledby={`${id}-tab-${tab.value}`}
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
  closable?: boolean;
  closeDisabled?: boolean;
  closeLabel?: string;
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
