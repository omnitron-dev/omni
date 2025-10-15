# Omnitron Module Architecture

## Executive Summary

This document defines the modular architecture for the Omnitron application using Aether's module system with dependency injection. The architecture organizes the application into feature modules with clear boundaries, shared services, and proper dependency management.

---

## 1. Module Structure Overview

Omnitron is organized into the following modules:

### 1.1 Core Module
**Purpose**: Singleton services, shared state, routing, and core infrastructure

**Responsibilities**:
- Application-wide singleton services
- Global state management
- Router configuration
- Theme management
- Authentication/authorization
- Event bus for inter-module communication

### 1.2 Feature Modules
**Purpose**: Encapsulated feature implementations

**Modules**:
- **CanvasModule**: Flow programming visual canvas
- **EditorModule**: Code editor functionality
- **TerminalModule**: Integrated terminal emulator
- **ChatModule**: AI assistant interface
- **SettingsModule**: Application configuration

### 1.3 Shared Module
**Purpose**: Reusable UI components and utilities

**Responsibilities**:
- Common UI components (Button, Card, Modal, etc.)
- Utility functions
- Shared directives and pipes
- Form components

---

## 2. Detailed Module Definitions

### 2.1 CoreModule

**Location**: `@apps/omnitron/web/src/core/`

**Services**:
- `RouterService` - Navigation and route management
- `ThemeService` - Theme switching and management
- `EventBusService` - Application-wide event communication
- `StorageService` - LocalStorage/SessionStorage abstraction
- `AuthService` - Authentication state (future)
- `ApiService` - HTTP client for backend communication (future)

**Stores**:
- `AppStore` - Global application state
- `ThemeStore` - Theme preferences and state
- `UserStore` - User profile and preferences (future)

**Providers Configuration**:
```typescript
// core/core.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';

// Services
@Injectable({ scope: 'singleton', providedIn: 'root' })
export class RouterService {
  // Router service implementation
}

@Injectable({ scope: 'singleton', providedIn: 'root' })
export class ThemeService {
  // Theme service implementation
}

@Injectable({ scope: 'singleton', providedIn: 'root' })
export class EventBusService {
  // Event bus implementation
}

@Injectable({ scope: 'singleton', providedIn: 'root' })
export class StorageService {
  // Storage service implementation
}

// Core Module Definition
export const CoreModule = defineModule({
  id: 'core',
  version: '1.0.0',

  providers: [
    RouterService,
    ThemeService,
    EventBusService,
    StorageService,
  ],

  stores: [
    () => import('./stores/app.store'),
    () => import('./stores/theme.store'),
  ],

  exportProviders: [
    RouterService,
    ThemeService,
    EventBusService,
    StorageService,
  ],

  exportStores: ['app', 'theme'],

  metadata: {
    name: 'Core Module',
    description: 'Core infrastructure and singleton services',
    author: 'Omnitron Team',
  },
});

// Guard against re-import
let imported = false;
export const CoreModuleForRoot = () => {
  if (imported) {
    throw new Error('CoreModule has already been loaded. Import it only in AppModule.');
  }
  imported = true;
  return CoreModule;
};
```

**File Structure**:
```
core/
├── core.module.ts           # Module definition
├── services/
│   ├── router.service.ts    # Router service
│   ├── theme.service.ts     # Theme service
│   ├── event-bus.service.ts # Event bus
│   └── storage.service.ts   # Storage abstraction
├── stores/
│   ├── app.store.ts         # App state
│   └── theme.store.ts       # Theme state
├── guards/
│   └── auth.guard.ts        # Auth guard (future)
└── index.ts                 # Barrel exports
```

---

### 2.2 CanvasModule

**Location**: `@apps/omnitron/web/src/modules/canvas/`

**Services**:
- `CanvasService` - Canvas state management
- `FlowService` - Flow operations (create, update, delete)
- `NodeService` - Node operations
- `ConnectionService` - Connection management
- `CanvasRenderService` - Canvas rendering logic

**Stores**:
- `CanvasStore` - Canvas state (zoom, pan, selected elements)
- `FlowStore` - Flow data and operations

**Components**:
- `FlowCanvas` - Main canvas component
- `FlowList` - List of available flows
- `NodePalette` - Node library/palette
- `NodeEditor` - Node property editor
- `CanvasToolbar` - Canvas tools
- `Minimap` - Canvas overview

**Module Definition**:
```typescript
// modules/canvas/canvas.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

// Services
@Injectable({ scope: 'module' })
export class CanvasService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService
  ) {}
  // Canvas service implementation
}

@Injectable({ scope: 'module' })
export class FlowService {
  constructor(
    private canvasService: CanvasService,
    private eventBus: EventBusService
  ) {}
  // Flow service implementation
}

@Injectable({ scope: 'module' })
export class NodeService {
  // Node service implementation
}

@Injectable({ scope: 'module' })
export class ConnectionService {
  // Connection service implementation
}

@Injectable({ scope: 'module' })
export class CanvasRenderService {
  // Render service implementation
}

// Module Definition
export const CanvasModule = defineModule({
  id: 'canvas',
  version: '1.0.0',

  imports: [CoreModule],

  providers: [
    CanvasService,
    FlowService,
    NodeService,
    ConnectionService,
    CanvasRenderService,
  ],

  stores: [
    () => import('./stores/canvas.store'),
    () => import('./stores/flow.store'),
  ],

  routes: [
    {
      path: '/',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
    {
      path: '/canvas',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
  ],

  exports: [
    // Components that other modules can use
  ],

  exportProviders: [
    FlowService, // Export for other modules to query flows
  ],

  exportStores: ['canvas', 'flow'],

  metadata: {
    name: 'Canvas Module',
    description: 'Visual flow programming canvas',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
```

**File Structure**:
```
modules/canvas/
├── canvas.module.ts         # Module definition
├── components/
│   ├── CanvasView.tsx       # Main canvas view
│   ├── FlowCanvas.tsx       # Canvas component
│   ├── FlowList.tsx         # Flow list
│   ├── NodePalette.tsx      # Node palette
│   ├── NodeEditor.tsx       # Node editor
│   ├── CanvasToolbar.tsx    # Toolbar
│   └── Minimap.tsx          # Minimap
├── services/
│   ├── canvas.service.ts    # Canvas service
│   ├── flow.service.ts      # Flow service
│   ├── node.service.ts      # Node service
│   ├── connection.service.ts # Connection service
│   └── canvas-render.service.ts # Render service
├── stores/
│   ├── canvas.store.ts      # Canvas state
│   └── flow.store.ts        # Flow state
├── types/
│   ├── canvas.types.ts      # Canvas types
│   ├── flow.types.ts        # Flow types
│   └── node.types.ts        # Node types
└── index.ts                 # Barrel exports
```

---

### 2.3 EditorModule

**Location**: `@apps/omnitron/web/src/modules/editor/`

**Services**:
- `EditorService` - Editor state management
- `FileService` - File operations
- `SyntaxService` - Syntax highlighting
- `CompletionService` - Code completion
- `LinterService` - Code linting

**Stores**:
- `EditorStore` - Editor state and configuration
- `FileStore` - Open files and file tree

**Components**:
- `CodeEditor` - Monaco-based code editor
- `FileTree` - File explorer tree
- `EditorToolbar` - Editor toolbar
- `SearchPanel` - Search and replace

**Module Definition**:
```typescript
// modules/editor/editor.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

// Services
@Injectable({ scope: 'module' })
export class EditorService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService
  ) {}
  // Editor service implementation
}

@Injectable({ scope: 'module' })
export class FileService {
  // File service implementation
}

@Injectable({ scope: 'module' })
export class SyntaxService {
  // Syntax service implementation
}

@Injectable({ scope: 'module' })
export class CompletionService {
  // Completion service implementation
}

@Injectable({ scope: 'module' })
export class LinterService {
  // Linter service implementation
}

// Module Definition
export const EditorModule = defineModule({
  id: 'editor',
  version: '1.0.0',

  imports: [CoreModule],

  providers: [
    EditorService,
    FileService,
    SyntaxService,
    CompletionService,
    LinterService,
  ],

  stores: [
    () => import('./stores/editor.store'),
    () => import('./stores/file.store'),
  ],

  routes: [
    {
      path: '/editor',
      component: () => import('./components/EditorView'),
      meta: { title: 'Code Editor - Omnitron' },
    },
  ],

  exportProviders: [
    EditorService,
  ],

  exportStores: ['editor', 'file'],

  metadata: {
    name: 'Editor Module',
    description: 'Code editor with Monaco',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
```

**File Structure**:
```
modules/editor/
├── editor.module.ts         # Module definition
├── components/
│   ├── EditorView.tsx       # Main editor view
│   ├── CodeEditor.tsx       # Monaco editor
│   ├── FileTree.tsx         # File tree
│   ├── EditorToolbar.tsx    # Toolbar
│   └── SearchPanel.tsx      # Search panel
├── services/
│   ├── editor.service.ts    # Editor service
│   ├── file.service.ts      # File service
│   ├── syntax.service.ts    # Syntax service
│   ├── completion.service.ts # Completion
│   └── linter.service.ts    # Linter
├── stores/
│   ├── editor.store.ts      # Editor state
│   └── file.store.ts        # File state
├── types/
│   └── editor.types.ts      # Editor types
└── index.ts                 # Barrel exports
```

---

### 2.4 TerminalModule

**Location**: `@apps/omnitron/web/src/modules/terminal/`

**Services**:
- `TerminalService` - Terminal state and operations
- `ShellService` - Shell session management
- `CommandService` - Command execution
- `HistoryService` - Command history

**Stores**:
- `TerminalStore` - Terminal state and sessions

**Components**:
- `Terminal` - Terminal component (xterm.js)
- `TerminalToolbar` - Terminal toolbar
- `SessionManager` - Session management

**Module Definition**:
```typescript
// modules/terminal/terminal.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

// Services
@Injectable({ scope: 'module' })
export class TerminalService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService
  ) {}
  // Terminal service implementation
}

@Injectable({ scope: 'module' })
export class ShellService {
  // Shell service implementation
}

@Injectable({ scope: 'module' })
export class CommandService {
  // Command service implementation
}

@Injectable({ scope: 'module' })
export class HistoryService {
  // History service implementation
}

// Module Definition
export const TerminalModule = defineModule({
  id: 'terminal',
  version: '1.0.0',

  imports: [CoreModule],

  providers: [
    TerminalService,
    ShellService,
    CommandService,
    HistoryService,
  ],

  stores: [
    () => import('./stores/terminal.store'),
  ],

  routes: [
    {
      path: '/terminal',
      component: () => import('./components/TerminalView'),
      meta: { title: 'Terminal - Omnitron' },
    },
  ],

  exportProviders: [
    TerminalService,
  ],

  exportStores: ['terminal'],

  metadata: {
    name: 'Terminal Module',
    description: 'Integrated terminal emulator',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
```

**File Structure**:
```
modules/terminal/
├── terminal.module.ts       # Module definition
├── components/
│   ├── TerminalView.tsx     # Main terminal view
│   ├── Terminal.tsx         # Terminal component
│   ├── TerminalToolbar.tsx  # Toolbar
│   └── SessionManager.tsx   # Session manager
├── services/
│   ├── terminal.service.ts  # Terminal service
│   ├── shell.service.ts     # Shell service
│   ├── command.service.ts   # Command service
│   └── history.service.ts   # History service
├── stores/
│   └── terminal.store.ts    # Terminal state
├── types/
│   └── terminal.types.ts    # Terminal types
└── index.ts                 # Barrel exports
```

---

### 2.5 ChatModule

**Location**: `@apps/omnitron/web/src/modules/chat/`

**Services**:
- `ChatService` - Chat state and operations
- `MessageService` - Message handling
- `AIService` - AI backend communication
- `ContextService` - Conversation context management

**Stores**:
- `ChatStore` - Chat state and conversations

**Components**:
- `ChatView` - Main chat interface
- `MessageList` - Message list component
- `MessageInput` - Message input field
- `ConversationList` - Conversation history

**Module Definition**:
```typescript
// modules/chat/chat.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

// Services
@Injectable({ scope: 'module' })
export class ChatService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService
  ) {}
  // Chat service implementation
}

@Injectable({ scope: 'module' })
export class MessageService {
  // Message service implementation
}

@Injectable({ scope: 'module' })
export class AIService {
  // AI service implementation
}

@Injectable({ scope: 'module' })
export class ContextService {
  // Context service implementation
}

// Module Definition
export const ChatModule = defineModule({
  id: 'chat',
  version: '1.0.0',

  imports: [CoreModule],

  providers: [
    ChatService,
    MessageService,
    AIService,
    ContextService,
  ],

  stores: [
    () => import('./stores/chat.store'),
  ],

  routes: [
    {
      path: '/chat',
      component: () => import('./components/ChatView'),
      meta: { title: 'AI Chat - Omnitron' },
    },
  ],

  exportProviders: [
    ChatService,
  ],

  exportStores: ['chat'],

  metadata: {
    name: 'Chat Module',
    description: 'AI assistant chat interface',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
```

**File Structure**:
```
modules/chat/
├── chat.module.ts           # Module definition
├── components/
│   ├── ChatView.tsx         # Main chat view
│   ├── MessageList.tsx      # Message list
│   ├── MessageInput.tsx     # Input field
│   └── ConversationList.tsx # Conversation list
├── services/
│   ├── chat.service.ts      # Chat service
│   ├── message.service.ts   # Message service
│   ├── ai.service.ts        # AI service
│   └── context.service.ts   # Context service
├── stores/
│   └── chat.store.ts        # Chat state
├── types/
│   └── chat.types.ts        # Chat types
└── index.ts                 # Barrel exports
```

---

### 2.6 SettingsModule

**Location**: `@apps/omnitron/web/src/modules/settings/`

**Services**:
- `SettingsService` - Settings management
- `PreferencesService` - User preferences
- `ConfigService` - Configuration management

**Stores**:
- `SettingsStore` - Settings state

**Components**:
- `SettingsView` - Settings view
- `SettingsPanel` - Settings panel
- `PreferenceEditor` - Preference editor

**Module Definition**:
```typescript
// modules/settings/settings.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

// Services
@Injectable({ scope: 'module' })
export class SettingsService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService,
    private theme: ThemeService
  ) {}
  // Settings service implementation
}

@Injectable({ scope: 'module' })
export class PreferencesService {
  // Preferences service implementation
}

@Injectable({ scope: 'module' })
export class ConfigService {
  // Config service implementation
}

// Module Definition
export const SettingsModule = defineModule({
  id: 'settings',
  version: '1.0.0',

  imports: [CoreModule],

  providers: [
    SettingsService,
    PreferencesService,
    ConfigService,
  ],

  stores: [
    () => import('./stores/settings.store'),
  ],

  routes: [
    {
      path: '/settings',
      component: () => import('./components/SettingsView'),
      meta: { title: 'Settings - Omnitron' },
    },
  ],

  exportProviders: [
    SettingsService,
  ],

  exportStores: ['settings'],

  metadata: {
    name: 'Settings Module',
    description: 'Application settings and configuration',
    author: 'Omnitron Team',
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
  },
});
```

**File Structure**:
```
modules/settings/
├── settings.module.ts       # Module definition
├── components/
│   ├── SettingsView.tsx     # Main settings view
│   ├── SettingsPanel.tsx    # Settings panel
│   └── PreferenceEditor.tsx # Preference editor
├── services/
│   ├── settings.service.ts  # Settings service
│   ├── preferences.service.ts # Preferences
│   └── config.service.ts    # Config service
├── stores/
│   └── settings.store.ts    # Settings state
├── types/
│   └── settings.types.ts    # Settings types
└── index.ts                 # Barrel exports
```

---

### 2.7 SharedModule

**Location**: `@apps/omnitron/web/src/shared/`

**Components**:
- `Button` - Button component
- `Card` - Card component
- `Modal` - Modal component
- `Input` - Input component
- `Select` - Select component
- `Checkbox` - Checkbox component
- `Icon` - Icon component
- `Tooltip` - Tooltip component

**Pipes**:
- `DatePipe` - Date formatting
- `NumberPipe` - Number formatting
- `TextPipe` - Text transformations

**Module Definition**:
```typescript
// shared/shared.module.ts
import { defineModule } from '@omnitron-dev/aether';

// Module Definition
export const SharedModule = defineModule({
  id: 'shared',
  version: '1.0.0',

  components: [
    () => import('./components/Button'),
    () => import('./components/Card'),
    () => import('./components/Modal'),
    () => import('./components/Input'),
    () => import('./components/Select'),
    () => import('./components/Checkbox'),
    () => import('./components/Icon'),
    () => import('./components/Tooltip'),
  ],

  // Export all components for use in other modules
  exports: [
    'Button',
    'Card',
    'Modal',
    'Input',
    'Select',
    'Checkbox',
    'Icon',
    'Tooltip',
  ],

  metadata: {
    name: 'Shared Module',
    description: 'Reusable UI components and utilities',
    author: 'Omnitron Team',
  },
});
```

**File Structure**:
```
shared/
├── shared.module.ts         # Module definition
├── components/
│   ├── Button.tsx           # Button
│   ├── Card.tsx             # Card
│   ├── Modal.tsx            # Modal
│   ├── Input.tsx            # Input
│   ├── Select.tsx           # Select
│   ├── Checkbox.tsx         # Checkbox
│   ├── Icon.tsx             # Icon
│   └── Tooltip.tsx          # Tooltip
├── pipes/
│   ├── date.pipe.ts         # Date pipe
│   ├── number.pipe.ts       # Number pipe
│   └── text.pipe.ts         # Text pipe
├── utils/
│   └── helpers.ts           # Helper functions
└── index.ts                 # Barrel exports
```

---

## 3. Module Dependencies

### 3.1 Dependency Graph

```
AppModule
├── CoreModule (singleton, eager)
├── SharedModule (eager)
├── CanvasModule (lazy)
│   └── imports: CoreModule
├── EditorModule (lazy)
│   └── imports: CoreModule
├── TerminalModule (lazy)
│   └── imports: CoreModule
├── ChatModule (lazy)
│   └── imports: CoreModule
└── SettingsModule (lazy)
    └── imports: CoreModule
```

### 3.2 Import/Export Rules

**CoreModule**:
- ✅ Imported by: All feature modules
- ❌ Imports: None (no dependencies)
- ✅ Exports: All providers and stores

**SharedModule**:
- ✅ Imported by: All modules that need UI components
- ❌ Imports: None (no dependencies)
- ✅ Exports: All components

**Feature Modules**:
- ✅ Import: CoreModule (always), SharedModule (optional)
- ✅ Export: Services that other modules need to use
- ❌ Don't export: Internal components and services

---

## 4. DI Configuration

### 4.1 Using inject() in Components

```typescript
// modules/canvas/components/FlowCanvas.tsx
import { defineComponent, inject } from '@omnitron-dev/aether';
import { CanvasService } from '../services/canvas.service';
import { FlowService } from '../services/flow.service';
import { EventBusService } from '@/core/services/event-bus.service';

export const FlowCanvas = defineComponent(() => {
  // Inject services
  const canvasService = inject(CanvasService);
  const flowService = inject(FlowService);
  const eventBus = inject(EventBusService);

  // Use services
  const flows = flowService.getFlows();
  const selectedFlow = canvasService.getSelectedFlow();

  return () => (
    <div class="flow-canvas">
      {/* Component implementation */}
    </div>
  );
});
```

### 4.2 Using inject() in Services

```typescript
// modules/canvas/services/flow.service.ts
import { Injectable, inject } from '@omnitron-dev/aether/di';
import { EventBusService } from '@/core/services/event-bus.service';
import { StorageService } from '@/core/services/storage.service';

@Injectable({ scope: 'module' })
export class FlowService {
  private eventBus = inject(EventBusService);
  private storage = inject(StorageService);

  async getFlows() {
    // Implementation
  }

  async createFlow(name: string) {
    // Implementation
    this.eventBus.emit('flow:created', { name });
  }
}
```

### 4.3 Using constructor injection

```typescript
// modules/canvas/services/canvas.service.ts
import { Injectable } from '@omnitron-dev/aether/di';
import { EventBusService } from '@/core/services/event-bus.service';
import { StorageService } from '@/core/services/storage.service';

@Injectable({ scope: 'module' })
export class CanvasService {
  constructor(
    private eventBus: EventBusService,
    private storage: StorageService
  ) {}

  // Service methods
}
```

### 4.4 Using Stores

```typescript
// modules/canvas/stores/canvas.store.ts
import { Injectable, Store } from '@omnitron-dev/aether/di';
import { signal, computed } from '@omnitron-dev/aether';

@Injectable()
@Store({ scope: 'singleton' })
export class CanvasStore {
  // Reactive state
  zoom = signal(1.0);
  pan = signal({ x: 0, y: 0 });
  selectedNodes = signal<string[]>([]);

  // Computed values
  hasSelection = computed(() => this.selectedNodes().length > 0);

  // Actions
  setZoom(value: number) {
    this.zoom.set(value);
  }

  setPan(x: number, y: number) {
    this.pan.set({ x, y });
  }

  selectNode(id: string) {
    this.selectedNodes.update(nodes => [...nodes, id]);
  }

  clearSelection() {
    this.selectedNodes.set([]);
  }
}
```

```typescript
// modules/canvas/components/CanvasView.tsx
import { defineComponent, onMount } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { CanvasStore } from '../stores/canvas.store';

export const CanvasView = defineComponent(() => {
  const canvasStore = inject(CanvasStore);

  onMount(() => {
    canvasStore.setZoom(1.0);
  });

  return () => (
    <div class="canvas-view">
      <div>Zoom: {canvasStore.zoom()}</div>
      <div>Has Selection: {canvasStore.hasSelection() ? 'Yes' : 'No'}</div>
    </div>
  );
});
```

---

## 5. Root Module (AppModule)

### 5.1 AppModule Definition

```typescript
// app/app.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { CoreModule } from '@/core/core.module';
import { SharedModule } from '@/shared/shared.module';
import { CanvasModule } from '@/modules/canvas/canvas.module';
import { EditorModule } from '@/modules/editor/editor.module';
import { TerminalModule } from '@/modules/terminal/terminal.module';
import { ChatModule } from '@/modules/chat/chat.module';
import { SettingsModule } from '@/modules/settings/settings.module';
import { App } from './App';

export const AppModule = defineModule({
  id: 'app',
  version: '1.0.0',

  imports: [
    CoreModule,        // Core infrastructure (eager)
    SharedModule,      // Shared components (eager)
    CanvasModule,      // Canvas feature (lazy)
    EditorModule,      // Editor feature (lazy)
    TerminalModule,    // Terminal feature (lazy)
    ChatModule,        // Chat feature (lazy)
    SettingsModule,    // Settings feature (lazy)
  ],

  providers: [
    // Global app-level providers
  ],

  bootstrap: App,

  metadata: {
    name: 'Omnitron Application',
    description: 'The Meta-System for Fractal Computing',
    version: '1.0.0',
    author: 'Omnitron Team',
  },
});
```

### 5.2 Bootstrap

```typescript
// main.tsx
import { bootstrapModule } from '@omnitron-dev/aether/di';
import { mount } from '@omnitron-dev/aether';
import { AppModule } from './app/app.module';
import router from './router';
import './styles/index.css';

const root = document.getElementById('root');

if (!root) {
  throw new Error('Root element not found');
}

// Bootstrap the module system
const { container, component } = bootstrapModule(AppModule);

// Make container globally available (for debugging)
if (import.meta.env.DEV) {
  (window as any).__omnitron_container__ = container;
}

// Mount the application
mount(component, root);

// Start router
router.start();
```

---

## 6. Complete File Structure

```
apps/omnitron/web/src/
├── app/
│   ├── app.module.ts              # Root module
│   ├── App.tsx                    # Root component
│   └── index.ts                   # Barrel exports
│
├── core/                          # Core Module
│   ├── core.module.ts             # Module definition
│   ├── services/
│   │   ├── router.service.ts
│   │   ├── theme.service.ts
│   │   ├── event-bus.service.ts
│   │   └── storage.service.ts
│   ├── stores/
│   │   ├── app.store.ts
│   │   └── theme.store.ts
│   ├── guards/
│   │   └── auth.guard.ts
│   └── index.ts
│
├── modules/                       # Feature Modules
│   ├── canvas/                    # Canvas Module
│   │   ├── canvas.module.ts
│   │   ├── components/
│   │   │   ├── CanvasView.tsx
│   │   │   ├── FlowCanvas.tsx
│   │   │   ├── FlowList.tsx
│   │   │   ├── NodePalette.tsx
│   │   │   ├── NodeEditor.tsx
│   │   │   ├── CanvasToolbar.tsx
│   │   │   └── Minimap.tsx
│   │   ├── services/
│   │   │   ├── canvas.service.ts
│   │   │   ├── flow.service.ts
│   │   │   ├── node.service.ts
│   │   │   ├── connection.service.ts
│   │   │   └── canvas-render.service.ts
│   │   ├── stores/
│   │   │   ├── canvas.store.ts
│   │   │   └── flow.store.ts
│   │   ├── types/
│   │   │   ├── canvas.types.ts
│   │   │   ├── flow.types.ts
│   │   │   └── node.types.ts
│   │   └── index.ts
│   │
│   ├── editor/                    # Editor Module
│   │   ├── editor.module.ts
│   │   ├── components/
│   │   │   ├── EditorView.tsx
│   │   │   ├── CodeEditor.tsx
│   │   │   ├── FileTree.tsx
│   │   │   ├── EditorToolbar.tsx
│   │   │   └── SearchPanel.tsx
│   │   ├── services/
│   │   │   ├── editor.service.ts
│   │   │   ├── file.service.ts
│   │   │   ├── syntax.service.ts
│   │   │   ├── completion.service.ts
│   │   │   └── linter.service.ts
│   │   ├── stores/
│   │   │   ├── editor.store.ts
│   │   │   └── file.store.ts
│   │   ├── types/
│   │   │   └── editor.types.ts
│   │   └── index.ts
│   │
│   ├── terminal/                  # Terminal Module
│   │   ├── terminal.module.ts
│   │   ├── components/
│   │   │   ├── TerminalView.tsx
│   │   │   ├── Terminal.tsx
│   │   │   ├── TerminalToolbar.tsx
│   │   │   └── SessionManager.tsx
│   │   ├── services/
│   │   │   ├── terminal.service.ts
│   │   │   ├── shell.service.ts
│   │   │   ├── command.service.ts
│   │   │   └── history.service.ts
│   │   ├── stores/
│   │   │   └── terminal.store.ts
│   │   ├── types/
│   │   │   └── terminal.types.ts
│   │   └── index.ts
│   │
│   ├── chat/                      # Chat Module
│   │   ├── chat.module.ts
│   │   ├── components/
│   │   │   ├── ChatView.tsx
│   │   │   ├── MessageList.tsx
│   │   │   ├── MessageInput.tsx
│   │   │   └── ConversationList.tsx
│   │   ├── services/
│   │   │   ├── chat.service.ts
│   │   │   ├── message.service.ts
│   │   │   ├── ai.service.ts
│   │   │   └── context.service.ts
│   │   ├── stores/
│   │   │   └── chat.store.ts
│   │   ├── types/
│   │   │   └── chat.types.ts
│   │   └── index.ts
│   │
│   └── settings/                  # Settings Module
│       ├── settings.module.ts
│       ├── components/
│       │   ├── SettingsView.tsx
│       │   ├── SettingsPanel.tsx
│       │   └── PreferenceEditor.tsx
│       ├── services/
│       │   ├── settings.service.ts
│       │   ├── preferences.service.ts
│       │   └── config.service.ts
│       ├── stores/
│       │   └── settings.store.ts
│       ├── types/
│       │   └── settings.types.ts
│       └── index.ts
│
├── shared/                        # Shared Module
│   ├── shared.module.ts           # Module definition
│   ├── components/
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Modal.tsx
│   │   ├── Input.tsx
│   │   ├── Select.tsx
│   │   ├── Checkbox.tsx
│   │   ├── Icon.tsx
│   │   └── Tooltip.tsx
│   ├── pipes/
│   │   ├── date.pipe.ts
│   │   ├── number.pipe.ts
│   │   └── text.pipe.ts
│   ├── utils/
│   │   └── helpers.ts
│   └── index.ts
│
├── components/                    # Legacy components (migrate to modules)
│   └── Shell.tsx
│
├── router/                        # Router configuration (move to core)
│   └── index.ts
│
├── views/                         # Legacy views (migrate to modules)
│   └── ...
│
├── styles/                        # Global styles
│   └── index.css
│
├── main.tsx                       # Application entry point
└── test-setup.ts                  # Test setup
```

---

## 7. Implementation Examples

### 7.1 Creating a Service with DI

```typescript
// modules/canvas/services/flow.service.ts
import { Injectable, inject } from '@omnitron-dev/aether/di';
import { EventBusService } from '@/core/services/event-bus.service';
import { StorageService } from '@/core/services/storage.service';
import { signal } from '@omnitron-dev/aether';

export interface Flow {
  id: string;
  name: string;
  nodes: any[];
  connections: any[];
  createdAt: Date;
  updatedAt: Date;
}

@Injectable({ scope: 'module' })
export class FlowService {
  private eventBus = inject(EventBusService);
  private storage = inject(StorageService);

  private flows = signal<Flow[]>([]);

  async loadFlows(): Promise<Flow[]> {
    try {
      const stored = await this.storage.get<Flow[]>('flows');
      if (stored) {
        this.flows.set(stored);
        this.eventBus.emit('flows:loaded', { count: stored.length });
      }
      return this.flows();
    } catch (error) {
      this.eventBus.emit('flows:error', { error });
      throw error;
    }
  }

  async createFlow(name: string): Promise<Flow> {
    const flow: Flow = {
      id: crypto.randomUUID(),
      name,
      nodes: [],
      connections: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.flows.update(flows => [...flows, flow]);
    await this.saveFlows();
    this.eventBus.emit('flow:created', { flow });

    return flow;
  }

  async updateFlow(id: string, updates: Partial<Flow>): Promise<Flow> {
    this.flows.update(flows =>
      flows.map(f =>
        f.id === id
          ? { ...f, ...updates, updatedAt: new Date() }
          : f
      )
    );

    await this.saveFlows();
    const flow = this.flows().find(f => f.id === id)!;
    this.eventBus.emit('flow:updated', { flow });

    return flow;
  }

  async deleteFlow(id: string): Promise<void> {
    this.flows.update(flows => flows.filter(f => f.id !== id));
    await this.saveFlows();
    this.eventBus.emit('flow:deleted', { id });
  }

  getFlow(id: string): Flow | undefined {
    return this.flows().find(f => f.id === id);
  }

  getFlows(): Flow[] {
    return this.flows();
  }

  private async saveFlows(): Promise<void> {
    await this.storage.set('flows', this.flows());
  }
}
```

### 7.2 Using inject() in Components

```typescript
// modules/canvas/components/FlowList.tsx
import { defineComponent, onMount, For, Show } from '@omnitron-dev/aether';
import { inject } from '@omnitron-dev/aether/di';
import { FlowService } from '../services/flow.service';
import { CanvasStore } from '../stores/canvas.store';

export const FlowList = defineComponent(() => {
  const flowService = inject(FlowService);
  const canvasStore = inject(CanvasStore);

  onMount(async () => {
    await flowService.loadFlows();
  });

  const handleSelectFlow = (id: string) => {
    canvasStore.setSelectedFlow(id);
  };

  const handleCreateFlow = async () => {
    const name = prompt('Enter flow name:');
    if (name) {
      await flowService.createFlow(name);
    }
  };

  const handleDeleteFlow = async (id: string) => {
    if (confirm('Are you sure you want to delete this flow?')) {
      await flowService.deleteFlow(id);
    }
  };

  return () => (
    <div class="flow-list">
      <div class="flow-list-header">
        <h3>Flows</h3>
        <button onClick={handleCreateFlow}>+ New Flow</button>
      </div>

      <Show
        when={() => flowService.getFlows().length > 0}
        fallback={
          <div class="empty-state">
            <p>No flows yet</p>
            <button onClick={handleCreateFlow}>Create your first flow</button>
          </div>
        }
      >
        <For each={() => flowService.getFlows()}>
          {(flow) => (
            <div
              class={() =>
                `flow-item ${canvasStore.selectedFlow() === flow().id ? 'selected' : ''}`
              }
              onClick={() => handleSelectFlow(flow().id)}
            >
              <div class="flow-name">{flow().name}</div>
              <div class="flow-meta">
                {flow().nodes.length} nodes
                <button
                  class="delete-button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteFlow(flow().id);
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
});
```

### 7.3 Module Composition

```typescript
// modules/canvas/canvas.module.ts
import { defineModule } from '@omnitron-dev/aether';
import { CoreModule } from '@/core/core.module';
import { SharedModule } from '@/shared/shared.module';
import { CanvasService } from './services/canvas.service';
import { FlowService } from './services/flow.service';
import { NodeService } from './services/node.service';
import { ConnectionService } from './services/connection.service';
import { CanvasRenderService } from './services/canvas-render.service';

export const CanvasModule = defineModule({
  id: 'canvas',
  version: '1.0.0',

  // Import dependencies
  imports: [
    CoreModule,    // For EventBusService, StorageService, etc.
    SharedModule,  // For Button, Card, Modal, etc.
  ],

  // Register services
  providers: [
    CanvasService,
    FlowService,
    NodeService,
    ConnectionService,
    CanvasRenderService,
  ],

  // Register stores
  stores: [
    () => import('./stores/canvas.store'),
    () => import('./stores/flow.store'),
  ],

  // Register routes
  routes: [
    {
      path: '/',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
    {
      path: '/canvas',
      component: () => import('./components/CanvasView'),
      meta: { title: 'Flow Canvas - Omnitron' },
    },
  ],

  // Export what other modules can use
  exportProviders: [
    FlowService, // Other modules can query flows
  ],

  exportStores: ['canvas', 'flow'],

  metadata: {
    name: 'Canvas Module',
    description: 'Visual flow programming canvas',
    author: 'Omnitron Team',
    dependencies: ['CoreModule', 'SharedModule'],
  },

  optimization: {
    lazyBoundary: true,
    splitChunk: true,
    priority: 'high',
  },
});
```

### 7.4 Cross-Module Communication

```typescript
// modules/editor/services/editor.service.ts
import { Injectable, inject } from '@omnitron-dev/aether/di';
import { EventBusService } from '@/core/services/event-bus.service';
import { FlowService } from '@/modules/canvas/services/flow.service';

@Injectable({ scope: 'module' })
export class EditorService {
  private eventBus = inject(EventBusService);
  private flowService = inject(FlowService); // Cross-module dependency

  async openFlowCode(flowId: string): Promise<void> {
    const flow = this.flowService.getFlow(flowId);
    if (!flow) {
      throw new Error(`Flow ${flowId} not found`);
    }

    // Generate code from flow
    const code = this.generateCodeFromFlow(flow);

    // Open in editor
    this.eventBus.emit('editor:open', { code, language: 'typescript' });
  }

  private generateCodeFromFlow(flow: any): string {
    // Implementation
    return `// Generated from flow: ${flow.name}`;
  }
}
```

---

## 8. Migration Path

### 8.1 Phase 1: Core Infrastructure (Week 1)

**Tasks**:
1. Create `core/` directory structure
2. Implement CoreModule with services
3. Create core stores (AppStore, ThemeStore)
4. Update App.tsx to use CoreModule
5. Update main.tsx to bootstrap modules

**Files to create**:
- `core/core.module.ts`
- `core/services/router.service.ts`
- `core/services/theme.service.ts`
- `core/services/event-bus.service.ts`
- `core/services/storage.service.ts`
- `core/stores/app.store.ts`
- `core/stores/theme.store.ts`

### 8.2 Phase 2: Shared Module (Week 1)

**Tasks**:
1. Create `shared/` directory structure
2. Implement SharedModule
3. Extract common components to shared
4. Update imports across views

**Files to create**:
- `shared/shared.module.ts`
- `shared/components/Button.tsx`
- `shared/components/Card.tsx`
- `shared/components/Modal.tsx`
- etc.

### 8.3 Phase 3: Feature Modules (Week 2-3)

**Tasks**:
1. Create `modules/canvas/` - Migrate CanvasView
2. Create `modules/editor/` - Migrate EditorView
3. Create `modules/terminal/` - Migrate TerminalView
4. Create `modules/chat/` - Migrate ChatView
5. Create `modules/settings/` - Migrate SettingsView

**For each module**:
- Create module definition
- Implement services with DI
- Create stores
- Migrate components
- Update routes

### 8.4 Phase 4: Integration & Testing (Week 3-4)

**Tasks**:
1. Create AppModule
2. Update bootstrap code
3. Test cross-module communication
4. Test lazy loading
5. Performance optimization
6. Clean up legacy code

---

## 9. Best Practices

### 9.1 Module Design

1. **Single Responsibility**: Each module should have one clear purpose
2. **Minimize Exports**: Only export what other modules need
3. **Dependency Direction**: Feature modules depend on Core, not on each other (prefer event bus for communication)
4. **Lazy Loading**: Feature modules should be lazy-loaded
5. **Scope Properly**: Use appropriate DI scopes (singleton for app-wide, module for feature-specific)

### 9.2 Service Design

1. **Injectable Decorator**: Always use `@Injectable()` decorator
2. **Constructor Injection**: Prefer constructor injection for dependencies
3. **Scope Awareness**: Choose appropriate scope (singleton, module, transient)
4. **Event Communication**: Use EventBus for cross-module events
5. **Error Handling**: Implement proper error handling and logging

### 9.3 Store Design

1. **Store Decorator**: Use `@Store()` decorator for stores
2. **Reactive State**: Use signals for reactive state
3. **Computed Values**: Use computed() for derived state
4. **Actions**: Create methods for state mutations
5. **Persistence**: Use persistence options for user preferences

### 9.4 Component Design

1. **Inject Services**: Use inject() to access services
2. **Reactive Rendering**: Use signals and computed for reactivity
3. **Lifecycle Hooks**: Use onMount, onCleanup for side effects
4. **Event Handlers**: Define handlers outside render function
5. **Performance**: Use For, Show for efficient rendering

---

## 10. Testing Strategy

### 10.1 Unit Testing Services

```typescript
// modules/canvas/services/flow.service.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { bootstrapModule } from '@omnitron-dev/aether/di';
import { FlowService } from './flow.service';
import { CanvasModule } from '../canvas.module';

describe('FlowService', () => {
  let flowService: FlowService;

  beforeEach(() => {
    const { container } = bootstrapModule(CanvasModule);
    flowService = container.get(FlowService);
  });

  it('should create a flow', async () => {
    const flow = await flowService.createFlow('Test Flow');
    expect(flow.name).toBe('Test Flow');
    expect(flow.nodes).toEqual([]);
  });

  it('should load flows', async () => {
    await flowService.createFlow('Flow 1');
    await flowService.createFlow('Flow 2');
    const flows = await flowService.loadFlows();
    expect(flows).toHaveLength(2);
  });
});
```

### 10.2 Integration Testing Modules

```typescript
// app/app.module.spec.ts
import { describe, it, expect } from 'vitest';
import { bootstrapModule } from '@omnitron-dev/aether/di';
import { AppModule } from './app.module';
import { FlowService } from '@/modules/canvas/services/flow.service';
import { EventBusService } from '@/core/services/event-bus.service';

describe('AppModule', () => {
  it('should bootstrap successfully', () => {
    const { container } = bootstrapModule(AppModule);
    expect(container).toBeDefined();
  });

  it('should resolve services from different modules', () => {
    const { container } = bootstrapModule(AppModule);
    const flowService = container.get(FlowService);
    const eventBus = container.get(EventBusService);

    expect(flowService).toBeDefined();
    expect(eventBus).toBeDefined();
  });
});
```

---

## 11. Performance Optimization

### 11.1 Code Splitting

```typescript
// Automatic code splitting per module
export const CanvasModule = defineModule({
  // ...
  optimization: {
    lazyBoundary: true,      // Module boundary for lazy loading
    splitChunk: true,        // Split into separate chunk
    priority: 'high',        // Load priority
  },
});
```

### 11.2 Lazy Loading Strategies

```typescript
// routes can specify preload strategies
routes: [
  {
    path: '/canvas',
    component: () => import('./components/CanvasView'),
    meta: {
      preload: 'hover',  // Preload on link hover
    },
  },
]
```

### 11.3 Tree Shaking

```typescript
// Ensure proper exports for tree-shaking
export const CanvasModule = defineModule({
  exports: [
    // Only export what's needed
    'FlowCanvas',
    'NodePalette',
  ],
  exportProviders: [
    // Only export services other modules need
    FlowService,
  ],
});
```

---

## 12. Conclusion

This modular architecture provides:

1. **Clear Boundaries**: Each module has a clear purpose and boundaries
2. **Dependency Management**: Proper DI ensures clean dependencies
3. **Code Organization**: Logical structure that scales with the application
4. **Performance**: Lazy loading and code splitting built-in
5. **Maintainability**: Easy to understand, test, and modify
6. **Reusability**: Modules can be reused across different applications
7. **Type Safety**: Full TypeScript coverage with proper types

The architecture follows Aether's module system best practices while providing a solid foundation for the Omnitron application to grow and evolve.

---

## Appendix A: Quick Reference

### Module Definition Template

```typescript
import { defineModule } from '@omnitron-dev/aether';
import { Injectable } from '@omnitron-dev/aether/di';
import { CoreModule } from '@/core/core.module';

@Injectable({ scope: 'module' })
export class MyService {
  // Service implementation
}

export const MyModule = defineModule({
  id: 'my-module',
  version: '1.0.0',
  imports: [CoreModule],
  providers: [MyService],
  stores: [],
  routes: [],
  exports: [],
  exportProviders: [],
  exportStores: [],
  metadata: {
    name: 'My Module',
    description: 'Description',
  },
});
```

### Service Template

```typescript
import { Injectable, inject } from '@omnitron-dev/aether/di';
import { SomeService } from './some.service';

@Injectable({ scope: 'module' })
export class MyService {
  private someService = inject(SomeService);

  // Or constructor injection
  constructor(private anotherService: AnotherService) {}

  // Service methods
}
```

### Store Template

```typescript
import { Injectable, Store } from '@omnitron-dev/aether/di';
import { signal, computed } from '@omnitron-dev/aether';

@Injectable()
@Store({ scope: 'singleton' })
export class MyStore {
  // State
  data = signal<any[]>([]);

  // Computed
  count = computed(() => this.data().length);

  // Actions
  add(item: any) {
    this.data.update(d => [...d, item]);
  }
}
```

### Component with DI Template

```typescript
import { defineComponent, inject } from '@omnitron-dev/aether';
import { MyService } from '../services/my.service';
import { MyStore } from '../stores/my.store';

export const MyComponent = defineComponent(() => {
  const service = inject(MyService);
  const store = inject(MyStore);

  return () => (
    <div>
      {/* Component JSX */}
    </div>
  );
});
```

---

**Document Version**: 1.0.0
**Last Updated**: 2025-10-16
**Author**: Omnitron Architecture Team
