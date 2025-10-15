import { defineComponent, signal } from '@omnitron-dev/aether';
import { Link, useLocation, useNavigate } from '@omnitron-dev/aether/router';
import {
  ApplicationShell,
  ApplicationShellHeader,
  ApplicationShellSidebar,
  ApplicationShellMain,
  ApplicationShellStatusBar,
} from '@omnitron-dev/aether/primitives';

/**
 * Application Shell Component
 *
 * Main container that orchestrates all UI elements using Aether's ApplicationShell:
 * - Structured layout with Header, Sidebar, Main, and StatusBar regions
 * - Collapsible sidebar with workspace navigation
 * - Tab-based navigation in header
 * - Status bar with current route and version info
 *
 * Powered by Aether - Minimalist, high-performance frontend framework
 */
export const Shell = defineComponent((props: { children: any }) => {
  const sidebarVisible = signal(true);
  const location = useLocation();
  const navigate = useNavigate();

  const isActive = (path: string) => {
    return location().pathname === path ||
           (path === '/canvas' && location().pathname === '/');
  };

  const navigateTo = (path: string) => {
    navigate(path);
  };

  return () => (
    <ApplicationShell
      defaultSidebarOpen={true}
      sidebarOpen={sidebarVisible()}
      onSidebarOpenChange={(open) => sidebarVisible.set(open)}
    >
      {/* Header with branding, tabs, and actions */}
      <ApplicationShellHeader>
        <div class="shell-header-left">
          <button
            class="icon-button"
            onClick={() => sidebarVisible.set(!sidebarVisible())}
            title="Toggle Sidebar"
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

      {/* Collapsible Sidebar with workspace navigation */}
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

      {/* Main content area with router view */}
      <ApplicationShellMain>
        {props.children}
      </ApplicationShellMain>

      {/* Status Bar with current state and version info */}
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
