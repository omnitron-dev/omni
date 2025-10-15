# Canvas Module

The Canvas Module provides a visual flow programming interface for creating and editing flows in Omnitron.

## Architecture

This module follows the architecture defined in `apps/omnitron/specs/module-architecture.md`.

### Structure

```
canvas/
├── components/
│   ├── FlowCanvas.tsx          # Main canvas component
│   ├── FlowNode.tsx            # Node component
│   └── FlowConnection.tsx      # Connection line component
├── services/
│   ├── flow.service.ts         # Flow CRUD operations
│   └── canvas.service.ts       # Canvas state management
├── stores/
│   └── canvas.store.ts         # Canvas reactive state
├── styles/
│   └── canvas.css              # Component styles
├── canvas.module.ts            # Module definition
├── index.ts                    # Barrel exports
└── README.md                   # This file
```

## Components

### FlowCanvas

Main canvas component that renders flows with nodes and connections.

**Props:**
- `flowId: string | null` - ID of the flow to display

**Features:**
- Zoom and pan controls
- Node selection and dragging
- Connection visualization
- Toolbar with common actions

**Usage:**
```tsx
import { FlowCanvas } from '@/modules/canvas';

<FlowCanvas flowId={selectedFlowId} />
```

### FlowNode

Renders a single node in the flow canvas.

**Props:**
- `node: FlowNode` - Node data
- `selected?: boolean` - Selection state
- `onSelect?: (nodeId, addToSelection) => void` - Selection handler
- `onMove?: (nodeId, x, y) => void` - Movement handler

**Features:**
- Drag and drop
- Input/output port visualization
- Node data display
- Selection highlighting

### FlowConnection

Renders a connection line between two nodes.

**Props:**
- `connection: FlowConnection` - Connection data
- `nodes: FlowNode[]` - All nodes (for positioning)
- `selected?: boolean` - Selection state
- `onSelect?: (connectionId) => void` - Selection handler

**Features:**
- Bezier curve rendering
- Click detection
- Selection highlighting

## Services

### FlowService

Handles Flow CRUD operations and business logic.

**Methods:**
- `loadFlows()` - Load all flows from storage
- `createFlow(name)` - Create a new flow
- `updateFlow(id, updates)` - Update flow metadata
- `deleteFlow(id)` - Delete a flow
- `getFlow(id)` - Get a single flow
- `getFlows()` - Get all flows
- `addNode(flowId, node)` - Add node to flow
- `updateNode(flowId, nodeId, updates)` - Update node
- `removeNode(flowId, nodeId)` - Remove node
- `addConnection(flowId, connection)` - Add connection
- `removeConnection(flowId, connectionId)` - Remove connection

**Usage:**
```tsx
import { inject } from '@omnitron-dev/aether/di';
import { FlowService } from '@/modules/canvas';

const flowService = inject(FlowService);
const flows = await flowService.loadFlows();
```

### CanvasService

Manages canvas state and interactions.

**Methods:**
- `setZoom(zoom)` - Set zoom level
- `zoomIn()` / `zoomOut()` - Adjust zoom
- `resetZoom()` - Reset to 100%
- `setPan(x, y)` - Set pan offset
- `panBy(dx, dy)` - Pan by delta
- `resetPan()` - Reset pan
- `resetTransform()` - Reset zoom and pan
- `selectNode(nodeId, addToSelection)` - Select node
- `selectNodes(nodeIds)` - Select multiple nodes
- `selectConnection(connectionId, addToSelection)` - Select connection
- `clearSelection()` - Clear all selections
- `isNodeSelected(nodeId)` - Check node selection
- `isConnectionSelected(connectionId)` - Check connection selection
- `screenToCanvas(x, y)` - Convert coordinates
- `canvasToScreen(x, y)` - Convert coordinates

**Usage:**
```tsx
import { inject } from '@omnitron-dev/aether/di';
import { CanvasService } from '@/modules/canvas';

const canvasService = inject(CanvasService);
canvasService.zoomIn();
```

## Stores

### CanvasStore

Reactive state management for canvas.

**State:**
- `zoom` - Current zoom level
- `panX` / `panY` - Pan offset
- `selectedNodeIds` - Selected node IDs
- `selectedConnectionIds` - Selected connection IDs
- `isDragging` - Drag state
- `isPanning` - Pan state

**Computed:**
- `hasSelection` - Whether anything is selected
- `state` - Complete state object

**Actions:**
- `setZoom(value)` - Set zoom
- `setPan(x, y)` - Set pan
- `setSelectedNodeIds(ids)` - Set node selection
- `setSelectedConnectionIds(ids)` - Set connection selection
- `clearSelection()` - Clear selection
- `setIsDragging(value)` - Set drag state
- `setIsPanning(value)` - Set pan state
- `resetTransform()` - Reset transform

**Usage:**
```tsx
import { createCanvasStore } from '@/modules/canvas';

const store = createCanvasStore();
store.setZoom(1.5);
```

## Module Definition

The Canvas Module exports:

**Components:**
- `FlowCanvas` - Main canvas component
- `FlowNode` - Node component
- `FlowConnection` - Connection component

**Services:**
- `FlowService` - Flow operations
- `CanvasService` - Canvas state

**Stores:**
- `createCanvasStore()` - Canvas store factory

**Types:**
- All Flow-related types from shared types

## Integration

### With Core Module

The Canvas Module depends on Core Module services (when implemented):
- `EventBusService` - For inter-module communication
- `StorageService` - For persistent storage

### With Shared Module

Uses shared UI components (when implemented):
- `Button` - For toolbar buttons
- `Card` - For flow list items
- `Modal` - For dialogs

## Storage

Flows are stored in localStorage under the key `omnitron:flows`.

**Format:**
```json
[
  {
    "id": "uuid",
    "metadata": {
      "name": "Flow Name",
      "version": "1.0.0",
      "description": "",
      "author": "User",
      "created": "2025-10-16T00:00:00.000Z",
      "modified": "2025-10-16T00:00:00.000Z",
      "tags": []
    },
    "nodes": [...],
    "connections": [...]
  }
]
```

## Styling

Styles are defined in `styles/canvas.css`. Import in your main CSS:

```css
@import './modules/canvas/styles/canvas.css';
```

## Future Enhancements

- [ ] Real Aether DI integration
- [ ] Backend persistence via API
- [ ] Node library/palette
- [ ] Connection drawing mode
- [ ] Multi-selection with drag box
- [ ] Copy/paste nodes
- [ ] Undo/redo support
- [ ] Minimap component
- [ ] Node property editor
- [ ] Flow execution
- [ ] Real-time collaboration

## Notes

This implementation uses placeholder DI functions until Aether's full module system is implemented. The architecture follows the specifications in `module-architecture.md` and will integrate seamlessly when Aether is complete.
