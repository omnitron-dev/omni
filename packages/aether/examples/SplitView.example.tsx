/**
 * SplitView Component Examples
 *
 * Demonstrates various use cases for the SplitView component:
 * - Basic horizontal and vertical splits
 * - Multiple panels
 * - Collapsible panels
 * - localStorage persistence
 * - Size constraints
 */

import { SplitView } from '../src/components/layout/SplitView.js';
import { Box } from '../src/components/layout/Box.js';

// ============================================================================
// Example 1: Basic Horizontal Split
// ============================================================================

export function BasicHorizontalSplit() {
  return (
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'left', defaultSize: 300, minSize: 200, maxSize: 500 },
        { id: 'right', defaultSize: '*', minSize: 400 },
      ]}
    >
      <SplitView.Panel id="left">
        <Box padding="md">
          <h2>Left Panel</h2>
          <p>This panel has a default size of 300px with constraints.</p>
        </Box>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" />

      <SplitView.Panel id="right">
        <Box padding="md">
          <h2>Right Panel</h2>
          <p>This panel takes the remaining space with a minimum of 400px.</p>
        </Box>
      </SplitView.Panel>
    </SplitView>
  );
}

// ============================================================================
// Example 2: Three-Panel Layout with Collapsible Sidebar
// ============================================================================

export function ThreePanelLayout() {
  return (
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'sidebar', defaultSize: 250, minSize: 200, maxSize: 400, collapsible: true },
        { id: 'main', defaultSize: '*', minSize: 400 },
        { id: 'inspector', defaultSize: 300, minSize: 200, maxSize: 500, collapsible: true },
      ]}
      storageKey="app-layout"
    >
      <SplitView.Panel id="sidebar">
        <Box padding="md" bg="gray">
          <h3>Sidebar</h3>
          <p>Double-click the handle to collapse/expand</p>
        </Box>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" panelId="sidebar" />

      <SplitView.Panel id="main">
        <Box padding="md">
          <h2>Main Content</h2>
          <p>This is the main content area that takes up the flexible space.</p>
        </Box>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" panelId="inspector" />

      <SplitView.Panel id="inspector">
        <Box padding="md" bg="gray">
          <h3>Inspector</h3>
          <p>Properties and details panel</p>
        </Box>
      </SplitView.Panel>
    </SplitView>
  );
}

// ============================================================================
// Example 3: Vertical Split
// ============================================================================

export function VerticalSplit() {
  return (
    <SplitView
      direction="vertical"
      panels={[
        { id: 'top', defaultSize: 200, minSize: 100 },
        { id: 'bottom', defaultSize: '*', minSize: 200 },
      ]}
    >
      <SplitView.Panel id="top">
        <Box padding="md">
          <h2>Top Panel</h2>
        </Box>
      </SplitView.Panel>

      <SplitView.Handle direction="vertical" />

      <SplitView.Panel id="bottom">
        <Box padding="md">
          <h2>Bottom Panel</h2>
        </Box>
      </SplitView.Panel>
    </SplitView>
  );
}

// ============================================================================
// Example 4: IDE-like Layout (Nested SplitViews)
// ============================================================================

export function IDELayout() {
  return (
    <SplitView
      direction="vertical"
      panels={[
        { id: 'editor-area', defaultSize: '*', minSize: 300 },
        { id: 'terminal', defaultSize: 200, minSize: 100, maxSize: 400, collapsible: true },
      ]}
      storageKey="ide-layout"
    >
      <SplitView.Panel id="editor-area">
        {/* Nested horizontal split for sidebar + editor + inspector */}
        <SplitView
          direction="horizontal"
          panels={[
            { id: 'file-tree', defaultSize: 250, minSize: 150, maxSize: 400, collapsible: true },
            { id: 'editor', defaultSize: '*', minSize: 400 },
            { id: 'properties', defaultSize: 300, minSize: 200, maxSize: 500, collapsible: true },
          ]}
          storageKey="ide-horizontal"
        >
          <SplitView.Panel id="file-tree">
            <Box padding="md" bg="gray">
              <h3>File Explorer</h3>
            </Box>
          </SplitView.Panel>

          <SplitView.Handle direction="horizontal" panelId="file-tree" />

          <SplitView.Panel id="editor">
            <Box padding="md">
              <h3>Code Editor</h3>
            </Box>
          </SplitView.Panel>

          <SplitView.Handle direction="horizontal" panelId="properties" />

          <SplitView.Panel id="properties">
            <Box padding="md" bg="gray">
              <h3>Properties</h3>
            </Box>
          </SplitView.Panel>
        </SplitView>
      </SplitView.Panel>

      <SplitView.Handle direction="vertical" panelId="terminal" />

      <SplitView.Panel id="terminal">
        <Box padding="md" bg="black" color="white">
          <h3>Terminal</h3>
          <p>Double-click handle to collapse</p>
        </Box>
      </SplitView.Panel>
    </SplitView>
  );
}

// ============================================================================
// Example 5: Controlled Sizes with Callback
// ============================================================================

export function ControlledSizes() {
  const handleSizesChange = (sizes: number[]) => {
    console.log('Panel sizes changed:', sizes);
  };

  return (
    <SplitView
      direction="horizontal"
      panels={[
        { id: 'panel1', defaultSize: 300 },
        { id: 'panel2', defaultSize: 400 },
        { id: 'panel3', defaultSize: 300 },
      ]}
      onSizesChange={handleSizesChange}
    >
      <SplitView.Panel id="panel1">
        <Box padding="md">Panel 1</Box>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" />

      <SplitView.Panel id="panel2">
        <Box padding="md">Panel 2</Box>
      </SplitView.Panel>

      <SplitView.Handle direction="horizontal" />

      <SplitView.Panel id="panel3">
        <Box padding="md">Panel 3</Box>
      </SplitView.Panel>
    </SplitView>
  );
}
