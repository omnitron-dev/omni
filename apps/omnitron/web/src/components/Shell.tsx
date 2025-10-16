import { defineComponent, signal, effect, onCleanup } from '@omnitron-dev/aether';
import { Link, useLocation, useNavigate } from '@omnitron-dev/aether/router';
import {
  ApplicationShell,
  ApplicationShellHeader,
  ApplicationShellActivityBar,
  ApplicationShellSidebar,
  ApplicationShellMain,
  ApplicationShellPanel,
  ApplicationShellStatusBar,
  Tabs,
} from '@omnitron-dev/aether/primitives';

export interface ShellProps {
  children: any;
}

/**
 * Application Shell Component
 *
 * Main container that orchestrates all UI elements using Aether's ApplicationShell:
 * - Structured layout with Header, ActivityBar, Sidebar, Main, Panel, and StatusBar regions
 * - ActivityBar with icon-based primary navigation (VSCode-style)
 * - Collapsible sidebar with workspace navigation
 * - Collapsible panel with tabs for Terminal, Output, Problems
 * - Tab-based navigation in header
 * - Keyboard shortcuts: Cmd+B (sidebar toggle), Cmd+J (panel toggle)
 * - Status bar with current route and version info
 *
 * Powered by Aether - Minimalist, high-performance frontend framework
 *
 * NOTE: Due to an Aether bug where components are recreated instead of updated when props change,
 * we use direct DOM manipulation to toggle sidebar/panel visibility instead of controlled props.
 */
export const Shell = defineComponent((props: ShellProps) => {
  // Local state for shell controls
  const activeView = signal('files');
  const activePanelTab = signal('terminal');
  const sidebarOpen = signal(true);
  const panelOpen = signal(false);

  // Router state
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => location().pathname === path ||
           (path === '/canvas' && location().pathname === '/');

  const navigateTo = (path: string) => {
    navigate(path);
  };

  // Debounce flags to prevent infinite loops
  let isTogglingRef = false;

  // Toggle functions with direct DOM manipulation to work around Aether's component recreation bug
  const toggleSidebar = () => {
    if (isTogglingRef) return;

    isTogglingRef = true;
    try {
      const newState = !sidebarOpen();
      sidebarOpen.set(newState);

      // Direct DOM manipulation as workaround for Aether bug
      const sidebar = document.querySelector('[data-application-shell-sidebar]') as HTMLElement;
      if (sidebar) {
        sidebar.setAttribute('data-open', newState ? 'true' : 'false');
        sidebar.style.display = newState ? 'flex' : 'none';
      }
    } finally {
      setTimeout(() => { isTogglingRef = false; }, 100);
    }
  };

  const togglePanel = () => {
    if (isTogglingRef) return;

    isTogglingRef = true;
    try {
      const newState = !panelOpen();
      panelOpen.set(newState);

      // Direct DOM manipulation as workaround for Aether bug
      const panel = document.querySelector('[data-application-shell-panel]') as HTMLElement;
      if (panel) {
        panel.setAttribute('data-open', newState ? 'true' : 'false');
        panel.style.display = newState ? 'flex' : 'none';
      }
    } finally {
      setTimeout(() => { isTogglingRef = false; }, 100);
    }
  };

  const setPanelOpen = (open: boolean) => {
    panelOpen.set(open);

    // Direct DOM manipulation as workaround for Aether bug
    const panel = document.querySelector('[data-application-shell-panel]') as HTMLElement;
    if (panel) {
      panel.setAttribute('data-open', open ? 'true' : 'false');
      panel.style.display = open ? 'flex' : 'none';
    }
  };

  // Keyboard shortcuts
  effect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Cmd+B or Ctrl+B: Toggle sidebar
      if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
        event.preventDefault();
        toggleSidebar();
      }
      // Cmd+J or Ctrl+J: Toggle panel
      if ((event.metaKey || event.ctrlKey) && event.key === 'j') {
        event.preventDefault();
        togglePanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      window.removeEventListener('keydown', handleKeyDown);
    });
  });

  return () => (
    <ApplicationShell>
      {/* Header */}
      <ApplicationShellHeader>
        <div class="shell-header-left">
          <button
            class="icon-button"
            onClick={toggleSidebar}
            title="Toggle Sidebar (Cmd+B)"
          >
            ☰
          </button>
          <h1 class="shell-title" onClick={() => navigateTo('/')}>OMNITRON</h1>
        </div>
        <div class="shell-header-center">
          <nav class="shell-tabs">
            <button
              class={() => `tab-button ${isActive('/canvas') ? 'active' : ''}`}
              onClick={() => navigateTo('/canvas')}
            >
              Flow Canvas
            </button>
            <button
              class={() => `tab-button ${isActive('/editor') ? 'active' : ''}`}
              onClick={() => navigateTo('/editor')}
            >
              Code Editor
            </button>
            <button
              class={() => `tab-button ${isActive('/terminal') ? 'active' : ''}`}
              onClick={() => navigateTo('/terminal')}
            >
              Terminal
            </button>
            <button
              class={() => `tab-button ${isActive('/chat') ? 'active' : ''}`}
              onClick={() => navigateTo('/chat')}
            >
              AI Chat
            </button>
          </nav>
        </div>
        <div class="shell-header-right">
          <button class="icon-button" title="Command Palette">⌘K</button>
          <button class="icon-button" title="Notifications">🔔</button>
          <button
            class="icon-button"
            title="Settings"
            onClick={() => navigateTo('/settings')}
          >
            ⚙️
          </button>
        </div>
      </ApplicationShellHeader>

      {/* Main horizontal layout */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* ActivityBar */}
        <ApplicationShellActivityBar>
          <div class="activity-bar-content">
            <div class="activity-items-top">
              <button
                class={() => `activity-button ${activeView() === 'files' ? 'active' : ''}`}
                onClick={() => {
                  activeView.set('files');
                  navigateTo('/canvas');
                }}
                title="Files (Ctrl+Shift+E)"
                aria-label="Files"
              >
                📊
              </button>
              <button
                class={() => `activity-button ${activeView() === 'search' ? 'active' : ''}`}
                onClick={() => {
                  activeView.set('search');
                  navigateTo('/editor');
                }}
                title="Search (Ctrl+Shift+F)"
                aria-label="Search"
              >
                🔍
              </button>
              <button
                class={() => `activity-button ${activeView() === 'extensions' ? 'active' : ''}`}
                onClick={() => {
                  activeView.set('extensions');
                  navigateTo('/chat');
                }}
                title="Extensions (Ctrl+Shift+X)"
                aria-label="Extensions"
              >
                🧩
              </button>
              <button
                class={() => `activity-button ${activeView() === 'terminal' ? 'active' : ''}`}
                onClick={() => {
                  activeView.set('terminal');
                  navigateTo('/terminal');
                  setPanelOpen(true);
                }}
                title="Terminal (Ctrl+`)"
                aria-label="Terminal"
              >
                💻
              </button>
            </div>
            <div class="activity-items-bottom">
              <button
                class={() => `activity-button ${activeView() === 'settings' ? 'active' : ''}`}
                onClick={() => {
                  activeView.set('settings');
                  navigateTo('/settings');
                }}
                title="Settings (Ctrl+,)"
                aria-label="Settings"
              >
                ⚙️
              </button>
            </div>
          </div>
        </ApplicationShellActivityBar>

        {/* Sidebar */}
        <ApplicationShellSidebar width={280}>
          <div class="sidebar-section">
            <h3>Workspace</h3>
            <div class="sidebar-content">
              <div class="sidebar-nav">
                <Link href="/canvas" class="sidebar-item">
                  📊 Flows
                </Link>
                <Link href="/editor" class="sidebar-item">
                  📝 Files
                </Link>
                <Link href="/terminal" class="sidebar-item">
                  💻 Terminal
                </Link>
                <Link href="/chat" class="sidebar-item">
                  🤖 AI Assistant
                </Link>
                <Link href="/settings" class="sidebar-item">
                  ⚙️ Settings
                </Link>
              </div>
            </div>
          </div>

          <div class="sidebar-section">
            <h3>Recent</h3>
            <div class="sidebar-content">
              <p class="sidebar-hint">No recent items</p>
            </div>
          </div>
        </ApplicationShellSidebar>

        {/* Main */}
        <ApplicationShellMain>
          {props.children}
        </ApplicationShellMain>
      </div>

      {/* Panel */}
      <ApplicationShellPanel height={250} minHeight={150} maxHeight={600}>
        <div class="panel-container">
          <div class="panel-header">
            <Tabs defaultValue="terminal" onValueChange={(value) => activePanelTab.set(value)}>
              <div class="panel-tabs-wrapper">
                <Tabs.List>
                  <Tabs.Trigger value="terminal" class="panel-tab">
                    Terminal
                  </Tabs.Trigger>
                  <Tabs.Trigger value="output" class="panel-tab">
                    Output
                  </Tabs.Trigger>
                  <Tabs.Trigger value="problems" class="panel-tab">
                    Problems
                  </Tabs.Trigger>
                </Tabs.List>
              </div>
            </Tabs>
            <button
              class="panel-close-button"
              onClick={() => setPanelOpen(false)}
              title="Close Panel (Cmd+J)"
              aria-label="Close Panel"
            >
              ✕
            </button>
          </div>
          <div class="panel-content">
            <Tabs value={activePanelTab}>
              <Tabs.Content value="terminal" class="panel-tab-content">
                <div class="panel-placeholder">
                  <p>Terminal view will be implemented here</p>
                  <p class="panel-hint">Keyboard shortcut: Cmd+J to toggle</p>
                </div>
              </Tabs.Content>
              <Tabs.Content value="output" class="panel-tab-content">
                <div class="panel-placeholder">
                  <p>Output view will be implemented here</p>
                  <p class="panel-hint">Application logs and output</p>
                </div>
              </Tabs.Content>
              <Tabs.Content value="problems" class="panel-tab-content">
                <div class="panel-placeholder">
                  <p>Problems view will be implemented here</p>
                  <p class="panel-hint">Errors, warnings, and diagnostics</p>
                </div>
              </Tabs.Content>
            </Tabs>
          </div>
        </div>
      </ApplicationShellPanel>

      {/* StatusBar */}
      <ApplicationShellStatusBar>
        <div class="statusbar-left">
          <span class="status-indicator status-ready">●</span>
          <span>Ready</span>
          <span class="statusbar-separator">|</span>
          <span>{location().pathname}</span>
        </div>
        <div class="statusbar-right">
          <span>Aether v0.1.0</span>
          <span class="statusbar-separator">|</span>
          <span>Omnitron v0.1.0</span>
        </div>
      </ApplicationShellStatusBar>
    </ApplicationShell>
  );
});
