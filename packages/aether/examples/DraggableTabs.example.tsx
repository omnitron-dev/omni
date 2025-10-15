/**
 * DraggableTabs Component Examples
 *
 * Demonstrates various use cases for the DraggableTabs component:
 * - Basic usage with closeable tabs
 * - Tabs with pinned items
 * - Add new tab functionality
 * - Maximum tabs limit
 * - Different size variants
 * - Tabs with icons
 * - Browser-like tabs
 * - Editor-like tabs (VSCode style)
 */

import { DraggableTabs, type DraggableTabItem } from '../src/components/navigation/DraggableTabs.js';
import { signal } from '../src/core/reactivity/signal.js';

// ============================================================================
// Example 1: Basic Usage
// ============================================================================

export function BasicDraggableTabs() {
  const tabs = signal<DraggableTabItem[]>([
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
    { id: '3', label: 'Tab 3', closeable: true },
    { id: '4', label: 'Tab 4', closeable: true },
  ]);

  const activeTab = signal('1');

  const handleTabChange = (id: string) => {
    activeTab.set(id);
    console.log('Active tab changed to:', id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
    console.log(`Tab moved from index ${oldIndex} to ${newIndex}`);
  };

  const handleTabClose = (id: string) => {
    const currentTabs = tabs().filter((tab) => tab.id !== id);
    tabs.set(currentTabs);

    // If closing active tab, switch to first available
    if (activeTab() === id && currentTabs.length > 0) {
      activeTab.set(currentTabs[0].id);
    }

    console.log('Tab closed:', id);
  };

  return (
    <DraggableTabs
      tabs={tabs()}
      activeTab={activeTab()}
      onTabChange={handleTabChange}
      onTabReorder={handleTabReorder}
      onTabClose={handleTabClose}
    />
  );
}

// ============================================================================
// Example 2: Tabs with Pinned Items
// ============================================================================

export function TabsWithPinnedItems() {
  const tabs = signal<DraggableTabItem[]>([
    { id: 'home', label: 'Home', closeable: false, pinned: true },
    { id: 'dashboard', label: 'Dashboard', closeable: false, pinned: true },
    { id: 'tab1', label: 'Document 1', closeable: true },
    { id: 'tab2', label: 'Document 2', closeable: true },
    { id: 'tab3', label: 'Document 3', closeable: true },
  ]);

  const activeTab = signal('home');

  const handleTabChange = (id: string) => {
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    tabs.set(tabs().filter((tab) => tab.id !== id));
  };

  return (
    <div>
      <p style={{ marginBottom: '1rem', color: '#6b7280' }}>
        First two tabs are pinned and cannot be closed or reordered
      </p>
      <DraggableTabs
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={handleTabChange}
        onTabReorder={handleTabReorder}
        onTabClose={handleTabClose}
      />
    </div>
  );
}

// ============================================================================
// Example 3: Add New Tab
// ============================================================================

export function TabsWithAddButton() {
  const tabs = signal<DraggableTabItem[]>([
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
  ]);

  const activeTab = signal('1');
  let nextId = 3;

  const handleTabChange = (id: string) => {
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    const currentTabs = tabs().filter((tab) => tab.id !== id);
    tabs.set(currentTabs);

    if (activeTab() === id && currentTabs.length > 0) {
      activeTab.set(currentTabs[currentTabs.length - 1].id);
    }
  };

  const handleTabAdd = () => {
    const newTab: DraggableTabItem = {
      id: String(nextId),
      label: `Tab ${nextId}`,
      closeable: true,
    };

    tabs.set([...tabs(), newTab]);
    activeTab.set(newTab.id);
    nextId++;
  };

  return (
    <DraggableTabs
      tabs={tabs()}
      activeTab={activeTab()}
      onTabChange={handleTabChange}
      onTabReorder={handleTabReorder}
      onTabClose={handleTabClose}
      onTabAdd={handleTabAdd}
      showAddButton={true}
    />
  );
}

// ============================================================================
// Example 4: Maximum Tabs Limit
// ============================================================================

export function TabsWithMaxLimit() {
  const tabs = signal<DraggableTabItem[]>([
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
    { id: '3', label: 'Tab 3', closeable: true },
  ]);

  const activeTab = signal('1');
  let nextId = 4;
  const MAX_TABS = 5;

  const handleTabChange = (id: string) => {
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    const currentTabs = tabs().filter((tab) => tab.id !== id);
    tabs.set(currentTabs);

    if (activeTab() === id && currentTabs.length > 0) {
      activeTab.set(currentTabs[0].id);
    }
  };

  const handleTabAdd = () => {
    if (tabs().length < MAX_TABS) {
      const newTab: DraggableTabItem = {
        id: String(nextId),
        label: `Tab ${nextId}`,
        closeable: true,
      };

      tabs.set([...tabs(), newTab]);
      activeTab.set(newTab.id);
      nextId++;
    }
  };

  return (
    <div>
      <p style={{ marginBottom: '1rem', color: '#6b7280' }}>
        Maximum {MAX_TABS} tabs allowed. Add button is disabled when limit is reached.
      </p>
      <DraggableTabs
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={handleTabChange}
        onTabReorder={handleTabReorder}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        showAddButton={true}
        maxTabs={MAX_TABS}
      />
    </div>
  );
}

// ============================================================================
// Example 5: Size Variants
// ============================================================================

export function TabsSizeVariants() {
  const tabs: DraggableTabItem[] = [
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
    { id: '3', label: 'Tab 3', closeable: true },
  ];

  const activeTab = signal('1');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <div>
        <h3>Small Size</h3>
        <DraggableTabs tabs={tabs} activeTab={activeTab()} size="sm" onTabChange={(id) => activeTab.set(id)} />
      </div>

      <div>
        <h3>Medium Size (Default)</h3>
        <DraggableTabs tabs={tabs} activeTab={activeTab()} size="md" onTabChange={(id) => activeTab.set(id)} />
      </div>

      <div>
        <h3>Large Size</h3>
        <DraggableTabs tabs={tabs} activeTab={activeTab()} size="lg" onTabChange={(id) => activeTab.set(id)} />
      </div>
    </div>
  );
}

// ============================================================================
// Example 6: Tabs with Icons
// ============================================================================

export function TabsWithIcons() {
  const tabs = signal<DraggableTabItem[]>([
    {
      id: 'home',
      label: 'Home',
      icon: '🏠',
      closeable: false,
      pinned: true,
    },
    {
      id: 'search',
      label: 'Search',
      icon: '🔍',
      closeable: true,
    },
    {
      id: 'settings',
      label: 'Settings',
      icon: '⚙️',
      closeable: true,
    },
    {
      id: 'profile',
      label: 'Profile',
      icon: '👤',
      closeable: true,
    },
  ]);

  const activeTab = signal('home');

  const handleTabChange = (id: string) => {
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    tabs.set(tabs().filter((tab) => tab.id !== id));
  };

  return (
    <DraggableTabs
      tabs={tabs()}
      activeTab={activeTab()}
      onTabChange={handleTabChange}
      onTabReorder={handleTabReorder}
      onTabClose={handleTabClose}
    />
  );
}

// ============================================================================
// Example 7: Browser-like Tabs
// ============================================================================

export function BrowserLikeTabs() {
  const tabs = signal<DraggableTabItem[]>([
    {
      id: '1',
      label: 'New Tab',
      closeable: true,
      data: { url: 'https://example.com' },
    },
    {
      id: '2',
      label: 'GitHub',
      icon: '🐙',
      closeable: true,
      data: { url: 'https://github.com' },
    },
    {
      id: '3',
      label: 'Documentation',
      icon: '📚',
      closeable: true,
      data: { url: 'https://docs.example.com' },
    },
  ]);

  const activeTab = signal('1');
  let nextId = 4;

  const handleTabChange = (id: string) => {
    activeTab.set(id);
    const tab = tabs().find((t) => t.id === id);
    if (tab?.data?.url) {
      console.log('Navigate to:', tab.data.url);
    }
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    const currentTabs = tabs().filter((tab) => tab.id !== id);
    tabs.set(currentTabs);

    if (activeTab() === id) {
      const closedIndex = tabs().findIndex((t) => t.id === id);
      const nextTab = currentTabs[closedIndex] || currentTabs[closedIndex - 1];
      if (nextTab) {
        activeTab.set(nextTab.id);
      }
    }
  };

  const handleTabAdd = () => {
    const newTab: DraggableTabItem = {
      id: String(nextId),
      label: 'New Tab',
      closeable: true,
      data: { url: 'https://example.com' },
    };

    tabs.set([...tabs(), newTab]);
    activeTab.set(newTab.id);
    nextId++;
  };

  return (
    <div>
      <DraggableTabs
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={handleTabChange}
        onTabReorder={handleTabReorder}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        showAddButton={true}
        maxTabs={20}
      />
      <div style={{ padding: '1rem', borderTop: '1px solid #e5e7eb' }}>
        <p style={{ color: '#6b7280' }}>
          Active tab: {tabs().find((t) => t.id === activeTab())?.label} (
          {tabs().find((t) => t.id === activeTab())?.data?.url})
        </p>
      </div>
    </div>
  );
}

// ============================================================================
// Example 8: Editor-like Tabs (VSCode Style)
// ============================================================================

export function EditorLikeTabs() {
  const tabs = signal<DraggableTabItem[]>([
    {
      id: 'file1',
      label: 'index.ts',
      icon: '📄',
      closeable: true,
      data: { path: '/src/index.ts', modified: false },
    },
    {
      id: 'file2',
      label: 'App.tsx •',
      icon: '⚛️',
      closeable: true,
      data: { path: '/src/App.tsx', modified: true },
    },
    {
      id: 'file3',
      label: 'styles.css',
      icon: '🎨',
      closeable: true,
      data: { path: '/src/styles.css', modified: false },
    },
  ]);

  const activeTab = signal('file1');
  let nextId = 4;

  const handleTabChange = (id: string) => {
    activeTab.set(id);
    const tab = tabs().find((t) => t.id === id);
    if (tab?.data?.path) {
      console.log('Open file:', tab.data.path);
    }
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
  };

  const handleTabClose = (id: string) => {
    const tab = tabs().find((t) => t.id === id);

    // Confirm close if file is modified
    if (tab?.data?.modified) {
      const confirm = window.confirm(`${tab.label.replace(' •', '')} has unsaved changes. Close anyway?`);
      if (!confirm) return;
    }

    const currentTabs = tabs().filter((t) => t.id !== id);
    tabs.set(currentTabs);

    if (activeTab() === id && currentTabs.length > 0) {
      activeTab.set(currentTabs[0].id);
    }
  };

  const handleTabAdd = () => {
    const newTab: DraggableTabItem = {
      id: `file${nextId}`,
      label: `untitled-${nextId}.ts`,
      icon: '📄',
      closeable: true,
      data: { path: `/untitled-${nextId}.ts`, modified: true },
    };

    tabs.set([...tabs(), newTab]);
    activeTab.set(newTab.id);
    nextId++;
  };

  return (
    <div>
      <DraggableTabs
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={handleTabChange}
        onTabReorder={handleTabReorder}
        onTabClose={handleTabClose}
        onTabAdd={handleTabAdd}
        showAddButton={true}
        size="sm"
      />
      <div
        style={{
          padding: '1rem',
          backgroundColor: '#1e1e1e',
          color: '#d4d4d4',
          minHeight: '200px',
          fontFamily: 'monospace',
        }}
      >
        <p>Editor content for: {tabs().find((t) => t.id === activeTab())?.data?.path}</p>
        {tabs().find((t) => t.id === activeTab())?.data?.modified && (
          <p style={{ color: '#f59e0b', marginTop: '0.5rem' }}>⚠️ Unsaved changes</p>
        )}
      </div>
    </div>
  );
}

// ============================================================================
// Example 9: Controlled Tabs with External State
// ============================================================================

export function ControlledTabs() {
  const tabs = signal<DraggableTabItem[]>([
    { id: '1', label: 'Tab 1', closeable: true },
    { id: '2', label: 'Tab 2', closeable: true },
    { id: '3', label: 'Tab 3', closeable: true },
  ]);

  const activeTab = signal('1');
  const history = signal<string[]>([]);

  const handleTabChange = (id: string) => {
    history.set([...history(), `Changed to tab ${id}`]);
    activeTab.set(id);
  };

  const handleTabReorder = (oldIndex: number, newIndex: number) => {
    const currentTabs = [...tabs()];
    const [removed] = currentTabs.splice(oldIndex, 1);
    currentTabs.splice(newIndex, 0, removed);
    tabs.set(currentTabs);
    history.set([...history(), `Moved tab from ${oldIndex} to ${newIndex}`]);
  };

  const handleTabClose = (id: string) => {
    const tab = tabs().find((t) => t.id === id);
    tabs.set(tabs().filter((t) => t.id !== id));
    history.set([...history(), `Closed tab ${tab?.label}`]);

    if (activeTab() === id && tabs().length > 0) {
      activeTab.set(tabs()[0].id);
    }
  };

  return (
    <div>
      <DraggableTabs
        tabs={tabs()}
        activeTab={activeTab()}
        onTabChange={handleTabChange}
        onTabReorder={handleTabReorder}
        onTabClose={handleTabClose}
      />
      <div style={{ marginTop: '1rem', padding: '1rem', backgroundColor: '#f9fafb', borderRadius: '0.5rem' }}>
        <h4 style={{ marginBottom: '0.5rem' }}>Action History:</h4>
        <ul style={{ margin: 0, paddingLeft: '1.5rem' }}>
          {history().map((entry, index) => (
            <li key={index}>{entry}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
