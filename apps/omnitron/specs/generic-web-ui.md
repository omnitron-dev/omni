# Generic Web UI Architecture Specification

## 1. Executive Summary

This specification defines a universal, modular web application architecture based on Aether framework, inspired by industry-leading platforms like VSCode, n8n, Notion, Figma, and other modern web applications. The goal is to create a highly flexible, performant, and extensible UI system that can adapt to various use cases while maintaining consistency and developer experience.

## 2. Analysis of Modern Web UI Patterns

### 2.1 VSCode Pattern Analysis
- **Shell Architecture**: Activity Bar + Sidebar + Editor Groups + Panel + Status Bar
- **Command Palette**: Universal command execution system
- **Extension System**: Dynamic module loading with isolated contexts
- **Theme System**: Comprehensive theming with semantic tokens
- **Settings**: JSON-based configuration with UI overlay
- **Key Features**:
  - Multi-pane layout with flexible resizing
  - Tab management system
  - Contextual menus and toolbars
  - Integrated terminal
  - File explorer with tree view
  - Search and replace across files
  - Git integration
  - Debug console

### 2.2 n8n Pattern Analysis
- **Flow-based UI**: Canvas with draggable nodes
- **Split View**: Canvas + Properties Panel
- **Node Library**: Searchable component palette
- **Execution History**: Timeline view with debugging
- **Key Features**:
  - Visual programming interface
  - Real-time execution feedback
  - Node configuration panels
  - Connection management
  - Zoom and pan controls
  - Minimap navigation

### 2.3 Notion Pattern Analysis
- **Block-based Editor**: Composable content blocks
- **Database Views**: Table, Board, Calendar, Gallery, Timeline
- **Sidebar Navigation**: Hierarchical page structure
- **Slash Commands**: Quick insertion system
- **Key Features**:
  - WYSIWYG editing
  - Real-time collaboration
  - Page templates
  - Inline databases
  - Rich media embedding

### 2.4 Figma Pattern Analysis
- **Canvas-centric**: Infinite canvas with viewport controls
- **Inspector Panel**: Context-sensitive properties
- **Layers Panel**: Object hierarchy management
- **Component Library**: Reusable design elements
- **Key Features**:
  - Vector editing tools
  - Real-time multiplayer
  - Version history
  - Component variants
  - Auto-layout system

### 2.5 Common Patterns Identified
1. **Modular Shell Architecture**: Composable layout regions
2. **Command System**: Universal action execution
3. **Panel System**: Dockable, resizable, collapsible panels
4. **Tab Management**: Multi-document interface
5. **Contextual UI**: Adaptive interface based on context
6. **Search & Navigation**: Global and contextual search
7. **Theming**: Comprehensive visual customization
8. **Settings Management**: Layered configuration system
9. **Keyboard Navigation**: Full keyboard accessibility
10. **Extension/Plugin System**: Dynamic capability expansion

## 3. Omnitron Universal Architecture Design

### 3.1 Core Architecture Principles
1. **Modularity**: Everything is a module that can be dynamically loaded
2. **Reactivity**: Fine-grained reactivity using Aether signals
3. **Composability**: UI elements compose into complex interfaces
4. **Extensibility**: Plugin architecture for custom functionality
5. **Performance**: Lazy loading, virtual scrolling, and optimized rendering
6. **Accessibility**: WCAG 2.1 AAA compliance by default
7. **Responsiveness**: Adaptive layouts for all screen sizes
8. **Offline-First**: PWA with service worker caching
9. **Real-time**: WebSocket/SSE for live updates
10. **Type-Safety**: Full TypeScript coverage

### 3.2 Application Shell Structure

```typescript
interface ApplicationShell {
  // Core Regions
  header: HeaderRegion;
  activityBar: ActivityBarRegion;
  sidebar: SidebarRegion;
  mainContent: MainContentRegion;
  panel: PanelRegion;
  statusBar: StatusBarRegion;

  // Overlay Systems
  commandPalette: CommandPalette;
  notifications: NotificationCenter;
  dialogs: DialogManager;
  contextMenus: ContextMenuManager;
  tooltips: TooltipManager;

  // Services
  layoutManager: LayoutManager;
  themeManager: ThemeManager;
  settingsManager: SettingsManager;
  keybindingManager: KeybindingManager;
  extensionHost: ExtensionHost;
}
```

### 3.3 Module System Architecture

```typescript
// Base module interface
interface AetherModule {
  id: string;
  name: string;
  version: string;
  dependencies?: string[];
  provides?: ServiceProviders;
  exports?: ModuleExports;
  routes?: RouteDefinitions;
  commands?: CommandDefinitions;
  keybindings?: KeybindingDefinitions;
  settings?: SettingDefinitions;
  themes?: ThemeDefinitions;
  locales?: LocaleDefinitions;

  // Lifecycle
  onInstall?(): Promise<void>;
  onActivate?(context: ModuleContext): Promise<void>;
  onDeactivate?(): Promise<void>;
  onUninstall?(): Promise<void>;
}

// Module context provided to each module
interface ModuleContext {
  // Core services
  shell: ApplicationShell;
  router: Router;
  store: GlobalStore;
  api: APIClient;
  eventBus: EventBus;

  // UI services
  notifications: NotificationService;
  dialogs: DialogService;
  commands: CommandService;
  menus: MenuService;
  panels: PanelService;

  // Storage
  localStorage: ModuleStorage;
  sessionStorage: ModuleStorage;
  indexedDB: ModuleDatabase;

  // Communication
  broadcast: BroadcastChannel;
  webSocket: WebSocketManager;

  // Utilities
  i18n: I18nService;
  logger: Logger;
  analytics: Analytics;
}
```

### 3.4 Component Library Structure

#### 3.4.1 Layout Components
```typescript
// Core layout components
- Shell: Main application shell
- Region: Flexible layout region
- SplitView: Resizable split panels
- TabContainer: Tab management
- Workspace: Multi-pane workspace
- Panel: Dockable panel component
- Toolbar: Contextual toolbar
- Sidebar: Collapsible sidebar
- StatusBar: Information status bar
- Dock: Dockable container
```

#### 3.4.2 Navigation Components
```typescript
- ActivityBar: Primary navigation
- Breadcrumb: Hierarchical navigation
- TreeView: Hierarchical tree
- ListView: Virtualized list
- GridView: Grid layout
- Tabs: Tab navigation
- Pagination: Page navigation
- Stepper: Step navigation
- Timeline: Temporal navigation
- Minimap: Overview navigation
```

#### 3.4.3 Input Components
```typescript
- CommandPalette: Universal command input
- SearchBox: Search with filters
- AutoComplete: Suggestion input
- CodeEditor: Monaco-based editor
- MarkdownEditor: Rich text editor
- FormBuilder: Dynamic forms
- PropertyGrid: Property editor
- ColorPicker: Color selection
- DateTimePicker: Temporal input
- FileUpload: File management
```

#### 3.4.4 Display Components
```typescript
- DataTable: Advanced data grid
- Chart: Data visualization
- Canvas: Drawing surface
- Graph: Node-based view
- Calendar: Event display
- Kanban: Board view
- Gallery: Media grid
- Carousel: Image slider
- VideoPlayer: Media playback
- Terminal: Console emulator
```

#### 3.4.5 Feedback Components
```typescript
- Toast: Temporary notifications
- Alert: Important messages
- Progress: Operation progress
- Skeleton: Loading placeholder
- Spinner: Activity indicator
- Badge: Status indicator
- Tag: Categorical label
- Tooltip: Contextual help
- Popover: Additional info
- Tour: Guided walkthrough
```

### 3.5 Service Layer Architecture

#### 3.5.1 Core Services
```typescript
interface CoreServices {
  // Application
  app: ApplicationService;
  modules: ModuleService;
  extensions: ExtensionService;
  plugins: PluginService;

  // Data
  store: StoreService;
  api: APIService;
  graphql: GraphQLService;
  websocket: WebSocketService;

  // UI
  layout: LayoutService;
  theme: ThemeService;
  i18n: I18nService;
  a11y: AccessibilityService;

  // User
  auth: AuthService;
  user: UserService;
  preferences: PreferenceService;
  workspace: WorkspaceService;

  // System
  router: RouterService;
  events: EventService;
  commands: CommandService;
  shortcuts: ShortcutService;

  // Storage
  storage: StorageService;
  cache: CacheService;
  database: DatabaseService;
  files: FileService;

  // Communication
  notifications: NotificationService;
  messaging: MessagingService;
  collaboration: CollaborationService;
  sync: SyncService;

  // Development
  logger: LoggerService;
  debug: DebugService;
  profiler: ProfilerService;
  analytics: AnalyticsService;
}
```

### 3.6 State Management Architecture

```typescript
// Global state structure
interface GlobalState {
  // Application state
  app: {
    version: string;
    environment: string;
    features: FeatureFlags;
    status: ApplicationStatus;
  };

  // User state
  user: {
    profile: UserProfile;
    preferences: UserPreferences;
    session: SessionData;
  };

  // UI state
  ui: {
    layout: LayoutState;
    theme: ThemeState;
    locale: LocaleState;
    panels: PanelStates;
    dialogs: DialogStates;
    notifications: NotificationQueue;
  };

  // Workspace state
  workspace: {
    current: WorkspaceData;
    recent: RecentItems;
    open: OpenDocuments;
    unsaved: UnsavedChanges;
  };

  // Module states
  modules: Record<string, ModuleState>;
}

// State management using Aether signals
const createGlobalStore = () => {
  const state = signal<GlobalState>(initialState);

  // Computed values
  const isAuthenticated = computed(() => !!state().user.session);
  const currentTheme = computed(() => state().ui.theme);
  const activeModules = computed(() => Object.keys(state().modules));

  // Actions
  const actions = {
    updateUser: (user: Partial<UserProfile>) => {
      state.update(s => ({ ...s, user: { ...s.user, profile: { ...s.user.profile, ...user } } }));
    },
    setTheme: (theme: string) => {
      state.update(s => ({ ...s, ui: { ...s.ui, theme } }));
    },
    // ... more actions
  };

  return { state, actions, computed: { isAuthenticated, currentTheme, activeModules } };
};
```

### 3.7 Routing Architecture

```typescript
// Route configuration
interface RouteConfig {
  path: string;
  component?: Component;
  module?: string;
  layout?: LayoutType;
  guards?: RouteGuard[];
  meta?: RouteMeta;
  children?: RouteConfig[];

  // Lazy loading
  loadComponent?: () => Promise<Component>;
  loadModule?: () => Promise<Module>;

  // Data loading
  loader?: (context: LoaderContext) => Promise<any>;
  action?: (context: ActionContext) => Promise<any>;
}

// Dynamic route registration
const routeRegistry = {
  register(routes: RouteConfig[]) { /* ... */ },
  unregister(paths: string[]) { /* ... */ },
  update(path: string, config: Partial<RouteConfig>) { /* ... */ },
};
```

### 3.8 Theme System Architecture

```typescript
interface ThemeDefinition {
  name: string;
  type: 'light' | 'dark' | 'auto';

  // Color tokens
  colors: {
    primary: ColorScale;
    secondary: ColorScale;
    accent: ColorScale;
    neutral: ColorScale;
    success: ColorScale;
    warning: ColorScale;
    danger: ColorScale;
    info: ColorScale;

    // Semantic colors
    background: ColorLayers;
    foreground: ColorLayers;
    border: ColorLayers;
    shadow: ColorLayers;
  };

  // Typography
  typography: {
    fonts: FontFamilies;
    sizes: FontSizes;
    weights: FontWeights;
    lineHeights: LineHeights;
    letterSpacing: LetterSpacing;
  };

  // Spacing
  spacing: SpacingScale;

  // Layout
  layout: {
    breakpoints: Breakpoints;
    container: ContainerSizes;
    grid: GridConfig;
    radius: RadiusScale;
  };

  // Motion
  motion: {
    duration: DurationScale;
    easing: EasingFunctions;
    spring: SpringConfigs;
  };

  // Components
  components: ComponentThemeOverrides;
}
```

## 4. Implementation Roadmap

### Phase 1: Foundation (Week 1-2)
1. **Setup Core Architecture**
   - [ ] Implement base ApplicationShell structure
   - [ ] Setup module system with DI container
   - [ ] Create service layer foundation
   - [ ] Implement global state management
   - [ ] Setup routing system

2. **Essential Services**
   - [ ] Theme service with CSS variables
   - [ ] Layout service with flexible regions
   - [ ] Command service with registry
   - [ ] Settings service with persistence
   - [ ] Event bus for communication

### Phase 2: Component Library (Week 3-4)
1. **Layout Components**
   - [ ] Shell component with regions
   - [ ] SplitView with resizing
   - [ ] TabContainer with drag-drop
   - [ ] Panel system with docking
   - [ ] Toolbar with actions

2. **Core Components**
   - [ ] TreeView with virtual scrolling
   - [ ] DataTable with sorting/filtering
   - [ ] CommandPalette with fuzzy search
   - [ ] PropertyGrid for settings
   - [ ] SearchBox with filters

### Phase 3: Advanced Features (Week 5-6)
1. **Canvas System**
   - [ ] Implement flow canvas for visual programming
   - [ ] Node library with drag-drop
   - [ ] Connection management
   - [ ] Zoom/pan controls
   - [ ] Minimap navigation

2. **Editor Integration**
   - [ ] Monaco editor wrapper
   - [ ] Markdown editor with preview
   - [ ] Code highlighting
   - [ ] IntelliSense support
   - [ ] Multi-cursor editing

### Phase 4: Module System (Week 7-8)
1. **Module Infrastructure**
   - [ ] Module loader with dependencies
   - [ ] Extension host for isolation
   - [ ] Module marketplace UI
   - [ ] Auto-update system
   - [ ] Module sandboxing

2. **Built-in Modules**
   - [ ] File explorer module
   - [ ] Search module
   - [ ] Terminal module
   - [ ] Git integration module
   - [ ] Debug console module

### Phase 5: Collaboration (Week 9-10)
1. **Real-time Features**
   - [ ] WebSocket service
   - [ ] Presence system
   - [ ] Collaborative editing
   - [ ] Live cursors
   - [ ] Change notifications

2. **Sync & Storage**
   - [ ] IndexedDB integration
   - [ ] Cloud sync service
   - [ ] Offline queue
   - [ ] Conflict resolution
   - [ ] Version history

### Phase 6: Polish & Optimization (Week 11-12)
1. **Performance**
   - [ ] Code splitting optimization
   - [ ] Lazy loading strategies
   - [ ] Virtual scrolling everywhere
   - [ ] Memory management
   - [ ] Bundle size optimization

2. **Quality**
   - [ ] Comprehensive testing
   - [ ] Accessibility audit
   - [ ] Performance profiling
   - [ ] Documentation
   - [ ] Example applications

## 5. Missing Aether Components to Implement

### 5.1 High Priority Components
1. **ApplicationShell**: Main shell orchestrator
2. **SplitView**: Resizable split panels
3. **ActivityBar**: Primary navigation bar
4. **CommandPalette**: Universal command interface
5. **PropertyGrid**: Property editor
6. **TreeView**: Hierarchical tree with virtual scrolling
7. **DataTable**: Advanced data grid
8. **TabContainer**: Tab management with drag-drop
9. **Panel**: Dockable panel system
10. **Toolbar**: Contextual action bar

### 5.2 Medium Priority Components
1. **FlowCanvas**: Node-based visual programming
2. **CodeEditor**: Monaco editor wrapper
3. **MarkdownEditor**: Rich text editing
4. **Terminal**: Terminal emulator
5. **SearchBox**: Advanced search with filters
6. **Minimap**: Overview navigation
7. **Timeline**: Temporal navigation
8. **Kanban**: Board view
9. **Chart**: Data visualization
10. **Tour**: Guided walkthrough

### 5.3 Low Priority Components
1. **VideoPlayer**: Media playback
2. **AudioPlayer**: Audio playback
3. **PDFViewer**: PDF rendering
4. **Spreadsheet**: Excel-like grid
5. **Diagram**: Diagramming tool
6. **Whiteboard**: Collaborative drawing
7. **3DViewer**: 3D model viewer
8. **MapView**: Geographic maps
9. **Calendar**: Event calendar
10. **Gantt**: Project timeline

## 6. Module Implementations

### 6.1 Core Module Structure
```typescript
// Example: File Explorer Module
export const FileExplorerModule: AetherModule = {
  id: 'file-explorer',
  name: 'File Explorer',
  version: '1.0.0',

  provides: {
    services: [FileService, FileSystemProvider],
    components: [FileTree, FileList, FilePreview],
    commands: [OpenFile, SaveFile, DeleteFile],
  },

  routes: [
    { path: '/files', component: FileExplorerView },
    { path: '/files/:path*', component: FileDetailView },
  ],

  commands: {
    'file.open': { handler: openFile, keybinding: 'cmd+o' },
    'file.save': { handler: saveFile, keybinding: 'cmd+s' },
    'file.delete': { handler: deleteFile, keybinding: 'cmd+shift+delete' },
  },

  settings: {
    'files.exclude': { type: 'array', default: ['node_modules', '.git'] },
    'files.autoSave': { type: 'boolean', default: true },
  },

  async onActivate(context: ModuleContext) {
    // Register with activity bar
    context.shell.activityBar.register({
      id: 'files',
      icon: 'folder',
      tooltip: 'File Explorer',
      panel: FileExplorerPanel,
    });

    // Initialize file watcher
    this.watcher = new FileWatcher(context.store);
    await this.watcher.start();
  },
};
```

### 6.2 Service Implementation Pattern
```typescript
// Example: Theme Service
@Injectable()
export class ThemeService {
  private currentTheme = signal<ThemeDefinition>(defaultTheme);
  private themes = new Map<string, ThemeDefinition>();

  constructor(
    @Inject(StorageService) private storage: StorageService,
    @Inject(EventService) private events: EventService,
  ) {
    this.loadUserTheme();
  }

  register(theme: ThemeDefinition) {
    this.themes.set(theme.name, theme);
    this.events.emit('theme:registered', theme);
  }

  apply(themeName: string) {
    const theme = this.themes.get(themeName);
    if (!theme) throw new Error(`Theme ${themeName} not found`);

    this.currentTheme.set(theme);
    this.applyToDOM(theme);
    this.storage.set('theme', themeName);
    this.events.emit('theme:changed', theme);
  }

  private applyToDOM(theme: ThemeDefinition) {
    const root = document.documentElement;

    // Apply color tokens
    Object.entries(theme.colors).forEach(([key, value]) => {
      if (typeof value === 'object') {
        Object.entries(value).forEach(([shade, color]) => {
          root.style.setProperty(`--color-${key}-${shade}`, color);
        });
      } else {
        root.style.setProperty(`--color-${key}`, value);
      }
    });

    // Apply typography
    Object.entries(theme.typography.fonts).forEach(([key, value]) => {
      root.style.setProperty(`--font-${key}`, value);
    });

    // Apply spacing
    theme.spacing.forEach((value, index) => {
      root.style.setProperty(`--spacing-${index}`, value);
    });
  }
}
```

## 7. Configuration Examples

### 7.1 Application Configuration
```typescript
// apps/omnitron/web/src/config/app.config.ts
export const appConfig = {
  shell: {
    layout: 'ide', // 'ide' | 'dashboard' | 'canvas' | 'minimal'
    regions: {
      header: { visible: true, height: 48 },
      activityBar: { visible: true, width: 48, position: 'left' },
      sidebar: { visible: true, width: 300, position: 'left' },
      panel: { visible: true, height: 200, position: 'bottom' },
      statusBar: { visible: true, height: 24 },
    },
  },

  modules: {
    autoLoad: ['core', 'file-explorer', 'search', 'terminal'],
    lazy: ['git', 'debug', 'extensions'],
  },

  theme: {
    default: 'dark',
    auto: true, // Follow system theme
  },

  features: {
    collaboration: true,
    offlineMode: true,
    autoSave: true,
    telemetry: false,
  },
};
```

### 7.2 Module Registration
```typescript
// apps/omnitron/web/src/modules/index.ts
import { ModuleManager } from '@omnitron-dev/aether/modules';

export async function registerModules(manager: ModuleManager) {
  // Core modules
  await manager.register([
    () => import('./core'),
    () => import('./file-explorer'),
    () => import('./search'),
    () => import('./terminal'),
    () => import('./settings'),
  ]);

  // Optional modules
  if (appConfig.features.collaboration) {
    await manager.register(() => import('./collaboration'));
  }

  // Extension modules
  const extensions = await loadExtensions();
  await manager.registerExtensions(extensions);
}
```

## 8. Best Practices

### 8.1 Performance Guidelines
1. Use virtual scrolling for lists > 100 items
2. Implement lazy loading for all routes
3. Use web workers for heavy computations
4. Implement proper memoization for computed values
5. Use CSS containment for layout regions
6. Implement proper cleanup in component unmount
7. Use requestIdleCallback for non-critical updates
8. Implement progressive rendering for complex views

### 8.2 Accessibility Guidelines
1. Ensure full keyboard navigation
2. Implement proper ARIA labels and roles
3. Maintain focus management
4. Provide screen reader announcements
5. Ensure color contrast ratios
6. Support reduced motion preferences
7. Implement skip links
8. Provide alternative text for images

### 8.3 Development Guidelines
1. Follow single responsibility principle
2. Use dependency injection for services
3. Implement proper error boundaries
4. Write comprehensive tests
5. Document all public APIs
6. Use semantic versioning
7. Implement proper logging
8. Follow code review process

## 9. Testing Strategy

### 9.1 Unit Testing
```typescript
// Example component test
describe('CommandPalette', () => {
  it('should filter commands on search', async () => {
    const commands = [
      { id: 'file.open', label: 'Open File' },
      { id: 'file.save', label: 'Save File' },
    ];

    const { getByRole, getByText } = render(
      <CommandPalette commands={commands} />
    );

    const input = getByRole('searchbox');
    await userEvent.type(input, 'save');

    expect(getByText('Save File')).toBeInTheDocument();
    expect(queryByText('Open File')).not.toBeInTheDocument();
  });
});
```

### 9.2 Integration Testing
```typescript
// Example module integration test
describe('FileExplorerModule', () => {
  it('should integrate with shell', async () => {
    const shell = createTestShell();
    const module = new FileExplorerModule();

    await module.onActivate(shell.context);

    expect(shell.activityBar.items).toContainEqual(
      expect.objectContaining({ id: 'files' })
    );

    expect(shell.commands.getAll()).toContainEqual(
      expect.arrayContaining(['file.open', 'file.save'])
    );
  });
});
```

### 9.3 E2E Testing
```typescript
// Example E2E test
describe('Application Flow', () => {
  it('should open file from explorer', async () => {
    await page.goto('/');
    await page.click('[data-activity="files"]');
    await page.click('[data-file="src/index.ts"]');

    const editor = await page.waitForSelector('[data-editor]');
    const content = await editor.textContent();

    expect(content).toContain('export default');
  });
});
```

## 10. Deployment Architecture

### 10.1 Build Configuration
```typescript
// vite.config.ts
export default defineConfig({
  plugins: [
    aether({
      modules: {
        autoDiscover: true,
        federation: true,
      },
      optimization: {
        splitChunks: true,
        treeShaking: true,
        minify: true,
      },
      pwa: {
        manifest: true,
        workbox: true,
        assets: ['icons', 'fonts'],
      },
    }),
  ],

  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['@omnitron-dev/aether'],
          modules: ['./src/modules'],
          components: ['./src/components'],
        },
      },
    },
  },
});
```

### 10.2 Docker Configuration
```dockerfile
# Multi-stage build
FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM nginx:alpine
COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
```

## 11. Monitoring & Analytics

### 11.1 Performance Monitoring
```typescript
// Performance tracking
export const performanceMonitor = {
  trackComponentRender(name: string, duration: number) {
    analytics.track('component_render', { name, duration });
  },

  trackRouteChange(from: string, to: string, duration: number) {
    analytics.track('route_change', { from, to, duration });
  },

  trackAPICall(endpoint: string, duration: number, status: number) {
    analytics.track('api_call', { endpoint, duration, status });
  },
};
```

### 11.2 Error Tracking
```typescript
// Error boundary with reporting
export const ErrorBoundary = defineComponent(() => {
  const error = signal<Error | null>(null);

  onError((err) => {
    error.set(err);
    errorReporter.capture(err, {
      user: getCurrentUser(),
      context: getApplicationContext(),
    });
  });

  return () => (
    <Show when={error} fallback={<Slot />}>
      <ErrorDisplay error={error()} />
    </Show>
  );
});
```

## 12. Security Considerations

### 12.1 Content Security Policy
```typescript
// CSP configuration
export const cspConfig = {
  'default-src': ["'self'"],
  'script-src': ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
  'style-src': ["'self'", "'unsafe-inline'"],
  'img-src': ["'self'", 'data:', 'https:'],
  'connect-src': ["'self'", 'wss:', 'https://api.omnitron.dev'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'object-src': ["'none'"],
  'frame-ancestors': ["'none'"],
};
```

### 12.2 Authentication & Authorization
```typescript
// Auth service implementation
@Injectable()
export class AuthService {
  private user = signal<User | null>(null);
  private permissions = signal<Set<string>>(new Set());

  async login(credentials: Credentials): Promise<User> {
    const response = await api.post('/auth/login', credentials);
    const { user, token, permissions } = response.data;

    this.user.set(user);
    this.permissions.set(new Set(permissions));
    tokenManager.set(token);

    return user;
  }

  hasPermission(permission: string): boolean {
    return this.permissions().has(permission);
  }

  requirePermission(permission: string): void {
    if (!this.hasPermission(permission)) {
      throw new UnauthorizedError(`Missing permission: ${permission}`);
    }
  }
}
```

## 13. Conclusion

This specification provides a comprehensive blueprint for building a universal, modular web application using the Aether framework. The architecture draws from the best practices of industry-leading applications while maintaining flexibility and extensibility.

The implementation roadmap provides a clear path forward, with prioritized components and features. The modular architecture ensures that the system can grow and adapt to changing requirements while maintaining consistency and performance.

Key success factors:
1. **Modularity**: Everything is a module
2. **Reactivity**: Fine-grained updates with Aether signals
3. **Performance**: Lazy loading and virtual scrolling
4. **Extensibility**: Plugin architecture for customization
5. **Developer Experience**: TypeScript, hot reload, and great tooling
6. **User Experience**: Responsive, accessible, and intuitive

With this architecture, Omnitron will provide a solid foundation for building complex web applications that can scale from simple tools to enterprise platforms.