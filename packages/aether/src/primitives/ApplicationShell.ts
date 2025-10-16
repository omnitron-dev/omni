/**
 * ApplicationShell Primitive
 *
 * High-level composition component for modern web application layouts.
 * Provides standard regions: Header, ActivityBar, Sidebar, Main, Panel, StatusBar.
 *
 * @example
 * ```tsx
 * <ApplicationShell>
 *   <ApplicationShell.Header>
 *     <Logo />
 *     <Navigation />
 *   </ApplicationShell.Header>
 *   <ApplicationShell.ActivityBar>
 *     <ActivityButton icon="files" />
 *   </ApplicationShell.ActivityBar>
 *   <ApplicationShell.Sidebar>
 *     <FileTree />
 *   </ApplicationShell.Sidebar>
 *   <ApplicationShell.Main>
 *     <Editor />
 *   </ApplicationShell.Main>
 *   <ApplicationShell.Panel>
 *     <Terminal />
 *   </ApplicationShell.Panel>
 *   <ApplicationShell.StatusBar>
 *     <StatusInfo />
 *   </ApplicationShell.StatusBar>
 * </ApplicationShell>
 * ```
 */

import { defineComponent } from '../core/component/index.js';
import { createContext, useContext, provideContext } from '../core/component/context.js';
import type { Signal, WritableSignal } from '../core/reactivity/types.js';
import { signal, computed } from '../core/reactivity/index.js';
import { effect } from '../core/reactivity/effect.js';
import { createRef } from '../core/component/refs.js';
import { jsx } from '../jsx-runtime.js';

// ============================================================================
// Types
// ============================================================================

export type ApplicationShellLayout = 'horizontal' | 'vertical';

export interface ApplicationShellProps {
  /**
   * Layout orientation
   */
  layout?: ApplicationShellLayout;

  /**
   * Whether the sidebar is initially open
   */
  defaultSidebarOpen?: boolean;

  /**
   * Whether the panel is initially open
   */
  defaultPanelOpen?: boolean;

  /**
   * Controlled sidebar open state
   */
  sidebarOpen?: boolean;

  /**
   * Controlled panel open state
   */
  panelOpen?: boolean;

  /**
   * Callback when sidebar open state changes
   */
  onSidebarOpenChange?: (open: boolean) => void;

  /**
   * Callback when panel open state changes
   */
  onPanelOpenChange?: (open: boolean) => void;

  /**
   * Children
   */
  children?: any | (() => any);

  [key: string]: any;
}

export interface ApplicationShellHeaderProps {
  children?: any;
  [key: string]: any;
}

export interface ApplicationShellActivityBarProps {
  children?: any;
  [key: string]: any;
}

export interface ApplicationShellSidebarProps {
  /**
   * Sidebar width in pixels
   */
  width?: number;

  /**
   * Minimum width in pixels
   */
  minWidth?: number;

  /**
   * Maximum width in pixels
   */
  maxWidth?: number;

  children?: any;
  [key: string]: any;
}

export interface ApplicationShellMainProps {
  children?: any;
  [key: string]: any;
}

export interface ApplicationShellPanelProps {
  /**
   * Panel height in pixels (for horizontal layout)
   */
  height?: number;

  /**
   * Minimum height in pixels
   */
  minHeight?: number;

  /**
   * Maximum height in pixels
   */
  maxHeight?: number;

  children?: any;
  [key: string]: any;
}

export interface ApplicationShellStatusBarProps {
  children?: any;
  [key: string]: any;
}

// ============================================================================
// Context
// ============================================================================

export interface ApplicationShellContextValue {
  layout: ApplicationShellLayout;
  sidebarOpen: Signal<boolean>;
  panelOpen: Signal<boolean>;
  toggleSidebar: () => void;
  togglePanel: () => void;
  setSidebarOpen: (open: boolean) => void;
  setPanelOpen: (open: boolean) => void;
}

const ApplicationShellContext = createContext<ApplicationShellContextValue | null>(null);

export const useApplicationShellContext = (): ApplicationShellContextValue | null => useContext(ApplicationShellContext);

// ============================================================================
// Components
// ============================================================================

/**
 * ApplicationShell Root
 * Main container for the application shell layout
 */
export const ApplicationShell = defineComponent<ApplicationShellProps>((props) => {
  const layout = props.layout ?? 'horizontal';

  // Internal state for sidebar
  const internalSidebarOpen: WritableSignal<boolean> = signal(props.defaultSidebarOpen ?? true);
  const currentSidebarOpen = (): boolean => props.sidebarOpen ?? internalSidebarOpen();
  const setSidebarOpen = (open: boolean) => {
    if (props.sidebarOpen === undefined) internalSidebarOpen.set(open);
    props.onSidebarOpenChange?.(open);
  };

  // Internal state for panel
  const internalPanelOpen: WritableSignal<boolean> = signal(props.defaultPanelOpen ?? false);
  const currentPanelOpen = (): boolean => props.panelOpen ?? internalPanelOpen();
  const setPanelOpen = (open: boolean) => {
    if (props.panelOpen === undefined) internalPanelOpen.set(open);
    props.onPanelOpenChange?.(open);
  };

  const toggleSidebar = () => setSidebarOpen(!currentSidebarOpen());
  const togglePanel = () => setPanelOpen(!currentPanelOpen());

  const contextValue: ApplicationShellContextValue = {
    layout,
    sidebarOpen: computed(() => currentSidebarOpen()),
    panelOpen: computed(() => currentPanelOpen()),
    toggleSidebar,
    togglePanel,
    setSidebarOpen,
    setPanelOpen,
  };

  provideContext(ApplicationShellContext, contextValue);

  const rootRef = createRef<HTMLDivElement>();

  const refCallback = (element: HTMLDivElement | null) => {
    rootRef.current = element || undefined;
    if (!element) return;

    effect(() => {
      element.setAttribute('data-layout', layout);
      element.setAttribute('data-sidebar-open', currentSidebarOpen() ? 'true' : 'false');
      element.setAttribute('data-panel-open', currentPanelOpen() ? 'true' : 'false');
    });
  };

  return () => {
    const children = typeof props.children === 'function' ? props.children() : props.children;

     
    const {
      layout: _layout,
      defaultSidebarOpen: _defaultSidebarOpen,
      defaultPanelOpen: _defaultPanelOpen,
      sidebarOpen: _sidebarOpen,
      panelOpen: _panelOpen,
      onSidebarOpenChange: _onSidebarOpenChange,
      onPanelOpenChange: _onPanelOpenChange,
      children: _children,
      ...restProps
    } = props;

    return jsx('div', {
      ...restProps,
      ref: refCallback,
      'data-application-shell': '',
      'data-layout': layout,
      'data-sidebar-open': currentSidebarOpen() ? 'true' : 'false',
      'data-panel-open': currentPanelOpen() ? 'true' : 'false',
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100vh',
        overflow: 'hidden',
      },
      children,
    });
  };
});

/**
 * ApplicationShell Header
 * Top bar for logo, navigation, and actions
 */
export const ApplicationShellHeader = defineComponent<ApplicationShellHeaderProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('header', {
    ...restProps,
    'data-application-shell-header': '',
    role: 'banner',
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
      width: '100%',
      minHeight: '48px',
    },
    children,
  });
});

/**
 * ApplicationShell ActivityBar
 * Left sidebar with icons for primary navigation
 */
export const ApplicationShellActivityBar = defineComponent<ApplicationShellActivityBarProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('aside', {
    ...restProps,
    'data-application-shell-activity-bar': '',
    role: 'navigation',
    'aria-label': 'Activity Bar',
    style: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      flexShrink: 0,
      width: '48px',
    },
    children,
  });
});

/**
 * ApplicationShell Sidebar
 * Collapsible left panel for contextual content
 */
export const ApplicationShellSidebar = defineComponent<ApplicationShellSidebarProps>((props) => {
  const context = useApplicationShellContext();
  const sidebarRef = createRef<HTMLElement>();

  const refCallback = (element: HTMLElement | null) => {
    sidebarRef.current = element || undefined;
    if (!element || !context) return;

    effect(() => {
      const isOpen = context.sidebarOpen();
      element.setAttribute('data-open', isOpen ? 'true' : 'false');
      element.style.display = isOpen ? 'flex' : 'none';
    });
  };

  return () => {
    const isOpen = context ? context.sidebarOpen() : true;
    const width = props.width ?? 250;

     
    const { width: _width, minWidth, maxWidth, children, ...restProps } = props;

    return jsx('aside', {
      ...restProps,
      ref: refCallback,
      'data-application-shell-sidebar': '',
      'data-open': isOpen ? 'true' : 'false',
      role: 'complementary',
      'aria-label': 'Sidebar',
      style: {
        display: isOpen ? 'flex' : 'none',
        flexDirection: 'column',
        flexShrink: 0,
        width: `${width}px`,
        minWidth: minWidth ? `${minWidth}px` : undefined,
        maxWidth: maxWidth ? `${maxWidth}px` : undefined,
        overflow: 'auto',
      },
      children,
    });
  };
});

/**
 * ApplicationShell Main
 * Central content area - primary workspace
 */
export const ApplicationShellMain = defineComponent<ApplicationShellMainProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('main', {
    ...restProps,
    'data-application-shell-main': '',
    role: 'main',
    style: {
      display: 'flex',
      flexDirection: 'column',
      flex: 1,
      overflow: 'auto',
      minWidth: 0,
      minHeight: 0,
    },
    children,
  });
});

/**
 * ApplicationShell Panel
 * Bottom panel for terminal, output, etc. (collapsible)
 */
export const ApplicationShellPanel = defineComponent<ApplicationShellPanelProps>((props) => {
  const context = useApplicationShellContext();
  const panelRef = createRef<HTMLElement>();

  const refCallback = (element: HTMLElement | null) => {
    panelRef.current = element || undefined;
    if (!element || !context) return;

    effect(() => {
      const isOpen = context.panelOpen();
      element.setAttribute('data-open', isOpen ? 'true' : 'false');
      element.style.display = isOpen ? 'flex' : 'none';
    });
  };

  return () => {
    const isOpen = context ? context.panelOpen() : false;
    const height = props.height ?? 200;

     
    const { height: _height, minHeight, maxHeight, children, ...restProps } = props;

    return jsx('section', {
      ...restProps,
      ref: refCallback,
      'data-application-shell-panel': '',
      'data-open': isOpen ? 'true' : 'false',
      role: 'region',
      'aria-label': 'Panel',
      style: {
        display: isOpen ? 'flex' : 'none',
        flexDirection: 'column',
        flexShrink: 0,
        height: `${height}px`,
        minHeight: minHeight ? `${minHeight}px` : undefined,
        maxHeight: maxHeight ? `${maxHeight}px` : undefined,
        overflow: 'auto',
      },
      children,
    });
  };
});

/**
 * ApplicationShell StatusBar
 * Bottom status information bar
 */
export const ApplicationShellStatusBar = defineComponent<ApplicationShellStatusBarProps>((props) => () => {
  const { children, ...restProps } = props;

  return jsx('footer', {
    ...restProps,
    'data-application-shell-status-bar': '',
    role: 'contentinfo',
    style: {
      display: 'flex',
      alignItems: 'center',
      flexShrink: 0,
      width: '100%',
      minHeight: '24px',
    },
    children,
  });
});

// ============================================================================
// Attach sub-components
// ============================================================================

(ApplicationShell as any).Header = ApplicationShellHeader;
(ApplicationShell as any).ActivityBar = ApplicationShellActivityBar;
(ApplicationShell as any).Sidebar = ApplicationShellSidebar;
(ApplicationShell as any).Main = ApplicationShellMain;
(ApplicationShell as any).Panel = ApplicationShellPanel;
(ApplicationShell as any).StatusBar = ApplicationShellStatusBar;

// ============================================================================
// Type augmentation for sub-components
// ============================================================================

export interface ApplicationShellComponent {
  (props: ApplicationShellProps): any;
  Header: typeof ApplicationShellHeader;
  ActivityBar: typeof ApplicationShellActivityBar;
  Sidebar: typeof ApplicationShellSidebar;
  Main: typeof ApplicationShellMain;
  Panel: typeof ApplicationShellPanel;
  StatusBar: typeof ApplicationShellStatusBar;
}
