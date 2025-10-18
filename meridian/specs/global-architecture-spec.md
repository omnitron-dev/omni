# Meridian Global Architecture Specification
# Multi-Monorepo Knowledge Management System

**Версия**: 2.0.0
**Дата создания**: 18 октября 2025
**Статус**: Design Specification
**Совместимость**: Meridian MCP Server v1.0.0+, Strong Tools v1.0.0+

---

## Оглавление

1. [Обзор и Мотивация](#обзор-и-мотивация)
2. [Архитектурные Принципы](#архитектурные-принципы)
3. [Структура Хранилища](#структура-хранилища)
4. [Система Уникальных ID](#система-уникальных-id)
5. [Project Registry](#project-registry)
6. [Двухуровневая Архитектура](#двухуровневая-архитектура)
7. [Глобальный Сервер](#глобальный-сервер)
8. [Локальный MCP Сервер](#локальный-mcp-сервер)
9. [Кросс-Монорепозиторная Документация](#кросс-монорепозиторная-документация)
10. [Синхронизация и Кеширование](#синхронизация-и-кеширование)
11. [RocksDB Schema](#rocksdb-schema)
12. [Конфигурация](#конфигурация)
13. [CLI Commands](#cli-commands)
14. [MCP Tools](#mcp-tools)
15. [Workflows и Use Cases](#workflows-и-use-cases)
16. [Миграция и Совместимость](#миграция-и-совместимость)
17. [План Реализации](#план-реализации)

---

## Обзор и Мотивация

### Проблема

**Текущая архитектура** Meridian работает на уровне одного монорепозитория:
- Локальная RocksDB база в корне монорепозитория
- Изоляция данных между разными монорепозиториями
- Невозможность получить документацию из зависимостей в других монорепозиториях
- Потеря данных при перемещении проекта
- Нет глобального обзора всех проектов разработчика

### Реальный Сценарий

Разработчик работает над несколькими монорепозиториями:

```
/Users/dev/
  ├── work/
  │   ├── frontend-monorepo/         # Монорепозиторий A
  │   │   └── packages/
  │   │       └── ui-kit/            # Зависит от auth-lib
  │   └── backend-monorepo/          # Монорепозиторий B
  │       └── packages/
  │           └── auth-lib/          # Используется в ui-kit
  └── personal/
      └── side-project-monorepo/     # Монорепозиторий C
          └── packages/
              └── analytics/         # Зависит от ui-kit
```

**Текущая проблема:**
- При работе над `ui-kit` в монорепозитории A, Claude Code не может получить документацию для `auth-lib` из монорепозитория B
- При перемещении `backend-monorepo` из `/Users/dev/work` в `/Users/dev/projects`, индекс теряется
- Нет единого места для поиска по документации всех проектов

### Решение: Глобальная Архитектура

**Meridian Global Architecture** решает эти проблемы:

1. ✅ **Глобальный реестр проектов** - единая база всех проектов на машине разработчика
2. ✅ **Устойчивые к перемещению ID** - проекты можно переносить без потери данных
3. ✅ **Кросс-монорепозиторная документация** - доступ к документации из любого проекта
4. ✅ **Двухуровневое хранилище** - глобальная БД + локальные кеши
5. ✅ **Клиент-серверная архитектура** - глобальный сервер + локальные MCP серверы
6. ✅ **Глобальный поиск** - поиск по документации всех проектов
7. ✅ **Отслеживание зависимостей** - граф зависимостей между проектами из разных монорепозиториев

---

## Архитектурные Принципы

### 1. Global-First, Local-Cache

**Приоритет глобального хранилища:**
```
Source Code → Tree-sitter AST → Analysis → Global DB (~/.meridian/data/)
                                                ↓
                                         Local Cache ([monorepo]/.meridian/)
```

**Локальный кеш** используется для:
- Быстрого доступа к часто используемым данным
- Оффлайн работы (когда глобальный сервер недоступен)
- Минимизации latency при работе с локальным монорепозиторием

### 2. Identity-Based, Not Path-Based

**Устойчивые идентификаторы:**
- Проект идентифицируется по `@scope/name`, а не по пути
- Путь - это **изменяемая метадата**, а не идентификатор
- История перемещений сохраняется для аудита

### 3. Layered Architecture

**Три уровня:**

```
┌─────────────────────────────────────────┐
│  MCP Layer (Claude Code Integration)   │
│  meridian serve --stdio                 │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Global Server (Daemon)                 │
│  meridian server                        │
│  - Project Registry                     │
│  - Global Index                         │
│  - File Watching                        │
└────────────────┬────────────────────────┘
                 │
┌────────────────▼────────────────────────┐
│  Storage Layer                          │
│  - Global DB: ~/.meridian/data/         │
│  - Local Cache: [monorepo]/.meridian/   │
└─────────────────────────────────────────┘
```

### 4. Eventual Consistency

**Синхронизация:**
- Изменения в коде → глобальная БД (автоматически)
- Глобальная БД → локальный кеш (по запросу)
- Eventual consistency модель для кросс-монорепозиторных ссылок

### 5. Security and Isolation

**Безопасность:**
- MCP сервер работает в контексте конкретного монорепозитория
- Доступ к другим проектам - только для чтения (документация, примеры)
- Запись возможна только в текущий монорепозиторий
- Role-based access control (будущее расширение)

---

## Структура Хранилища

### Глобальное Хранилище

```
~/.meridian/                           # Глобальная директория Meridian
  ├── meridian.toml                    # Глобальный конфиг
  ├── data/                            # Глобальная RocksDB
  │   ├── registry/                    # Реестр проектов и монорепозиториев
  │   ├── symbols/                     # Все символы из всех проектов
  │   ├── docs/                        # Документация
  │   ├── examples/                    # Примеры кода
  │   ├── tests/                       # Тесты
  │   └── xref/                        # Кросс-ссылки между проектами
  ├── cache/                           # Глобальный кеш
  │   └── compiled/                    # Скомпилированные примеры
  ├── logs/                            # Логи сервера
  │   ├── server.log                   # Основной лог
  │   ├── indexing.log                 # Логи индексации
  │   └── errors.log                   # Ошибки
  ├── server.pid                       # PID глобального сервера
  └── state.json                       # Глобальное состояние

# Дополнительно (опционально)
~/.meridian/plugins/                   # Плагины для расширения функциональности
~/.meridian/backups/                   # Бэкапы БД
```

### Локальное Хранилище (Монорепозиторий)

```
[monorepo-path]/.meridian/             # Локальная директория монорепозитория
  ├── meridian.toml                    # Локальный конфиг
  ├── cache.db/                        # Локальный RocksDB кеш
  │   ├── symbols/                     # Кеш символов этого монорепозитория
  │   ├── docs/                        # Кеш документации
  │   └── external/                    # Кеш внешних зависимостей
  ├── state.json                       # Локальное состояние
  │                                    # - последняя синхронизация
  │                                    # - pending changes
  ├── .gitignore                       # Игнорируем cache.db/
  └── README.md                        # Документация для разработчиков

# .gitignore содержимое:
cache.db/
state.json
*.log
```

### Размещение Данных

**Что хранится в глобальной БД:**
- ✅ Реестр всех проектов
- ✅ Полный индекс символов
- ✅ Документация для всех проектов
- ✅ Кросс-проектные ссылки
- ✅ Dependency graph
- ✅ История индексации

**Что хранится в локальном кеше:**
- ✅ Быстрый доступ к символам текущего монорепозитория
- ✅ Кеш часто используемых внешних зависимостей
- ✅ Pending changes (не синхронизированные изменения)
- ✅ Локальная конфигурация

---

## Система Уникальных ID

### Проблема

Путь к проекту может изменяться (переименование, перемещение), но идентичность проекта должна сохраняться.

### Решение: Content-Based Identity

**Основа идентификации** - содержимое манифеста, а не путь:

```typescript
interface ProjectIdentity {
  // Основной ID (без версии)
  id: string;                          // "@omnitron-dev/titan"

  // Версия (для множественных версий одного проекта)
  version: string;                     // "1.0.0"

  // Полный уникальный ID
  fullId: string;                      // "@omnitron-dev/titan@1.0.0"

  // Контентный hash (для верификации)
  contentHash: string;                 // SHA256 от package.json/Cargo.toml

  // Тип проекта
  type: "npm" | "cargo" | "generic";
}
```

### Генерация ID

**TypeScript/JavaScript (npm packages):**
```typescript
// Из package.json
{
  "name": "@omnitron-dev/titan",  // → id
  "version": "1.0.0"              // → version
}

// Полный ID: "@omnitron-dev/titan@1.0.0"
```

**Rust (Cargo crates):**
```toml
# Из Cargo.toml
[package]
name = "meridian-core"  # → id
version = "1.0.0"       # → version

# Полный ID: "meridian-core@1.0.0"
```

**Generic Projects (без package manager):**
```typescript
// Генерация ID из содержимого
const contentHash = sha256(manifestContent);
const id = `generic-${contentHash.slice(0, 12)}`;

// Полный ID: "generic-a1b2c3d4e5f6@0.0.1"
```

### Monorepo ID

**Монорепозиторий** также имеет уникальный ID:

```typescript
interface MonorepoIdentity {
  // ID монорепозитория
  id: string;                          // "omnitron-dev" или auto-generated

  // Название (опционально)
  name?: string;                       // "Omnitron Development"

  // Контентный hash (root package.json или workspace manifest)
  contentHash: string;

  // Тип workspace
  type: "pnpm" | "npm" | "yarn" | "cargo" | "mixed";
}
```

**Определение Monorepo ID:**
1. Проверить `[monorepo]/.meridian/meridian.toml` → `monorepo.id`
2. Если нет, извлечь из root `package.json` → `name`
3. Если нет, сгенерировать из hash root manifest
4. Сохранить в `[monorepo]/.meridian/meridian.toml`

---

## Project Registry

### Концепция

**Project Registry** - глобальный реестр всех проектов на машине разработчика.

### Структура

```typescript
interface ProjectRegistry {
  // Identity
  identity: ProjectIdentity;

  // Location tracking
  currentPath: string;                 // Текущий абсолютный путь
  pathHistory: ProjectPathHistory[];   // История перемещений

  // Monorepo context
  monorepo?: {
    id: string;                        // ID монорепозитория
    path: string;                      // Путь к корню монорепозитория
    relativePath: string;              // Относительный путь внутри монорепозитория
  };

  // Project metadata
  metadata: ProjectMetadata;           // Из strong-tools-spec.md

  // Indexing state
  indexing: {
    lastIndexed: Date;
    indexVersion: string;              // Версия индексатора
    status: "indexed" | "indexing" | "error" | "pending";
    errorMessage?: string;
  };

  // Status
  status: "active" | "moved" | "deleted" | "stale";

  // Timestamps
  createdAt: Date;
  updatedAt: Date;
  lastAccessedAt: Date;
}

interface ProjectPathHistory {
  path: string;                        // Предыдущий путь
  timestamp: Date;
  reason: "discovered" | "relocated" | "auto-detected";
  initiatedBy?: string;                // "user" | "auto-scan" | "migration"
}
```

### Операции с Registry

**1. Регистрация проекта:**
```typescript
async function registerProject(path: string): Promise<ProjectRegistry> {
  // 1. Парсим манифест (package.json / Cargo.toml)
  const manifest = await parseManifest(path);

  // 2. Генерируем identity
  const identity = generateIdentity(manifest);

  // 3. Проверяем, существует ли уже
  const existing = await findByIdentity(identity);

  if (existing) {
    // Обновляем путь, если изменился
    if (existing.currentPath !== path) {
      return await relocateProject(existing, path);
    }
    return existing;
  }

  // 4. Создаем новую запись
  const registry: ProjectRegistry = {
    identity,
    currentPath: path,
    pathHistory: [{
      path,
      timestamp: new Date(),
      reason: "discovered"
    }],
    monorepo: await detectMonorepo(path),
    metadata: await extractMetadata(path),
    indexing: {
      status: "pending",
      indexVersion: CURRENT_INDEX_VERSION
    },
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastAccessedAt: new Date()
  };

  // 5. Сохраняем в глобальной БД
  await saveToRegistry(registry);

  // 6. Запускаем индексацию
  await enqueueIndexing(registry.identity.fullId);

  return registry;
}
```

**2. Перемещение проекта:**
```typescript
async function relocateProject(
  projectId: string,
  newPath: string,
  reason: string = "relocated"
): Promise<void> {
  const registry = await getFromRegistry(projectId);

  // Обновляем историю
  registry.pathHistory.push({
    path: registry.currentPath,
    timestamp: new Date(),
    reason
  });

  // Обновляем текущий путь
  registry.currentPath = newPath;
  registry.updatedAt = new Date();

  // Переиндексация не требуется (ID остается тот же)
  // Только если изменилось содержимое, что определяется contentHash

  await updateRegistry(registry);
}
```

**3. Поиск проекта:**
```typescript
// По ID
async function findByIdentity(identity: ProjectIdentity): Promise<ProjectRegistry | null>

// По пути
async function findByPath(path: string): Promise<ProjectRegistry | null>

// По имени
async function findByName(name: string): Promise<ProjectRegistry[]>

// Все проекты монорепозитория
async function findByMonorepo(monorepoId: string): Promise<ProjectRegistry[]>
```

### Auto-Discovery

**Автоматическое обнаружение проектов:**

```typescript
async function discoverProjects(rootPath: string): Promise<ProjectRegistry[]> {
  const discovered: ProjectRegistry[] = [];

  // 1. Определяем тип workspace
  const workspaceType = await detectWorkspace(rootPath);

  // 2. Ищем проекты
  const projectPaths = await findProjectsInWorkspace(rootPath, workspaceType);

  // 3. Регистрируем каждый проект
  for (const projectPath of projectPaths) {
    const registry = await registerProject(projectPath);
    discovered.push(registry);
  }

  return discovered;
}

async function detectWorkspace(rootPath: string): Promise<WorkspaceType> {
  // pnpm
  if (await exists(join(rootPath, "pnpm-workspace.yaml"))) {
    return "pnpm";
  }

  // npm/yarn workspaces
  const pkgJson = await readPackageJson(rootPath);
  if (pkgJson.workspaces) {
    return "npm";
  }

  // Cargo workspace
  const cargoToml = await readCargoToml(rootPath);
  if (cargoToml.workspace) {
    return "cargo";
  }

  return "none";
}
```

---

## Двухуровневая Архитектура

### Обзор

```
┌──────────────────────────────────────────────────────────────┐
│                       Claude Code                            │
│                    (MCP Client)                              │
└────────────────────────┬─────────────────────────────────────┘
                         │ STDIO
                         │
┌────────────────────────▼─────────────────────────────────────┐
│               Meridian MCP Server                            │
│               (meridian serve --stdio)                       │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Context: /Users/dev/work/frontend-monorepo        │     │
│  │  Monorepo ID: frontend-app                         │     │
│  │  Local Cache: .meridian/cache.db/                  │     │
│  └────────────────────────────────────────────────────┘     │
└────────────────────────┬─────────────────────────────────────┘
                         │ IPC / HTTP
                         │
┌────────────────────────▼─────────────────────────────────────┐
│               Meridian Global Server                         │
│               (meridian server --daemon)                     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Project Registry                                  │     │
│  │  - All projects across all monorepos              │     │
│  │  - Location tracking                              │     │
│  │  - Dependency graph                               │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  Global Index                                      │     │
│  │  - Symbols, Docs, Examples, Tests                 │     │
│  │  - Cross-monorepo references                      │     │
│  └────────────────────────────────────────────────────┘     │
│                                                              │
│  ┌────────────────────────────────────────────────────┐     │
│  │  File Watcher                                      │     │
│  │  - Watches all registered monorepos               │     │
│  │  - Incremental re-indexing                        │     │
│  └────────────────────────────────────────────────────┘     │
└────────────────────────┬─────────────────────────────────────┘
                         │
┌────────────────────────▼─────────────────────────────────────┐
│                   Storage Layer                              │
│                                                              │
│  Global DB: ~/.meridian/data/                                │
│  Local Caches: [monorepo]/.meridian/cache.db/               │
└──────────────────────────────────────────────────────────────┘
```

### Уровни

**1. MCP Layer**
- Интеграция с Claude Code
- STDIO транспорт
- MCP Protocol 2025-03-26

**2. Global Server Layer**
- Daemon процесс
- Управление всеми проектами
- Глобальная индексация
- File watching

**3. Storage Layer**
- Глобальная RocksDB
- Локальные кеши
- Синхронизация

---

## Глобальный Сервер

### Архитектура

```typescript
class MeridianGlobalServer {
  private globalDB: RocksDB;
  private projectRegistry: ProjectRegistryManager;
  private indexManager: GlobalIndexManager;
  private fileWatcher: GlobalFileWatcher;
  private mcpClients: Map<string, MCPClient>;  // Подключенные MCP серверы

  // IPC/HTTP сервер для communication с локальными MCP серверами
  private ipcServer: IPCServer;

  async start(): Promise<void> {
    // 1. Загрузить глобальную БД
    await this.loadGlobalDB();

    // 2. Загрузить project registry
    await this.projectRegistry.load();

    // 3. Запустить file watcher для всех монорепозиториев
    await this.startFileWatcher();

    // 4. Запустить IPC сервер
    await this.startIPCServer();

    console.log('Meridian Global Server started');
  }

  async stop(): Promise<void> {
    // Graceful shutdown
    await this.fileWatcher.stop();
    await this.ipcServer.stop();
    await this.globalDB.close();
  }
}
```

### Компоненты

#### 1. Project Registry Manager

```typescript
class ProjectRegistryManager {
  private db: RocksDB;

  // CRUD operations
  async register(path: string): Promise<ProjectRegistry>
  async get(projectId: string): Promise<ProjectRegistry | null>
  async update(registry: ProjectRegistry): Promise<void>
  async delete(projectId: string): Promise<void>

  // Search
  async findByPath(path: string): Promise<ProjectRegistry | null>
  async findByName(name: string): Promise<ProjectRegistry[]>
  async findByMonorepo(monorepoId: string): Promise<ProjectRegistry[]>
  async listAll(): Promise<ProjectRegistry[]>

  // Monorepo operations
  async addMonorepo(path: string): Promise<MonorepoInfo>
  async relocateMonorepo(monorepoId: string, newPath: string): Promise<void>
  async removeMonorepo(monorepoId: string): Promise<void>
}
```

#### 2. Global Index Manager

```typescript
class GlobalIndexManager {
  private symbolIndex: SymbolIndex;
  private docIndex: DocumentationIndex;
  private xrefIndex: CrossReferenceIndex;

  async indexProject(projectId: string): Promise<IndexResult>
  async reindexProject(projectId: string): Promise<IndexResult>
  async removeProjectIndex(projectId: string): Promise<void>

  // Query
  async searchSymbols(query: SearchQuery): Promise<SymbolSearchResult[]>
  async getDocumentation(projectId: string, symbolId: string): Promise<Documentation>
  async findCrossReferences(symbolId: string): Promise<CrossReference[]>
}
```

#### 3. Global File Watcher

```typescript
class GlobalFileWatcher {
  private watchers: Map<string, FileWatcher>;  // monorepoId → watcher

  async watchMonorepo(monorepoId: string, path: string): Promise<void> {
    const watcher = new FileWatcher(path, {
      ignore: ['node_modules', 'target', 'dist', '.git'],
      debounce: 500
    });

    watcher.on('change', async (event) => {
      await this.handleFileChange(monorepoId, event);
    });

    this.watchers.set(monorepoId, watcher);
  }

  private async handleFileChange(monorepoId: string, event: FileChangeEvent) {
    // 1. Определить, какой проект затронут
    const project = await this.findProjectByFile(event.path);

    // 2. Запустить инкрементальную переиндексацию
    await this.indexManager.reindexFile(project.identity.fullId, event.path);

    // 3. Уведомить подключенные MCP серверы
    await this.notifyMCPClients(project.identity.fullId, event);
  }
}
```

#### 4. IPC Server

```typescript
class IPCServer {
  private server: HTTPServer;  // или Unix socket

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.handleRequest(req, res);
    });

    await this.server.listen(MERIDIAN_IPC_PORT);
  }

  private async handleRequest(req: Request, res: Response) {
    const { method, params } = await req.json();

    switch (method) {
      case 'getProject':
        return await this.projectRegistry.get(params.projectId);

      case 'searchSymbols':
        return await this.indexManager.searchSymbols(params.query);

      case 'getDocumentation':
        return await this.indexManager.getDocumentation(params.projectId, params.symbolId);

      // ... other methods
    }
  }
}
```

### Запуск и Управление

**Запуск сервера:**
```bash
# Запуск в daemon режиме
meridian server --daemon

# Запуск в foreground (для отладки)
meridian server

# Проверка статуса
meridian server status

# Остановка
meridian server stop
```

**Управление проектами:**
```bash
# Добавить монорепозиторий
meridian projects add /path/to/monorepo

# Список всех проектов
meridian projects list

# Поиск проекта
meridian projects search "@omnitron-dev/titan"

# Перемещение монорепозитория
meridian projects relocate frontend-app /new/path

# Удаление проекта
meridian projects remove "@omnitron-dev/old-project"

# Переиндексация
meridian index --all
meridian index --project "@omnitron-dev/titan"
```

---

## Локальный MCP Сервер

### Архитектура

```typescript
class MeridianMCPServer {
  private globalClient: GlobalServerClient;   // Клиент к глобальному серверу
  private localCache: LocalCache;             // Локальный RocksDB кеш
  private monorepoContext: MonorepoContext;   // Контекст текущего монорепозитория

  constructor(monorepoPath: string) {
    this.monorepoContext = {
      path: monorepoPath,
      monorepoId: await this.detectMonorepoId(monorepoPath),
      projects: await this.loadLocalProjects(monorepoPath)
    };
  }

  async handleToolCall(tool: string, args: any): Promise<any> {
    // Двухуровневая стратегия:
    // 1. Проверить локальный кеш
    // 2. Если нет - запросить у глобального сервера
    // 3. Кешировать результат локально

    switch (tool) {
      case 'code.search_symbols':
        return await this.searchSymbols(args);

      case 'strong.catalog.search_documentation':
        return await this.searchDocumentation(args);

      case 'strong.docs.generate':
        return await this.generateDocumentation(args);

      // ... other tools
    }
  }

  private async searchSymbols(args: any): Promise<any> {
    // 1. Проверить локальный кеш
    const cached = await this.localCache.get(`symbols:search:${args.query}`);
    if (cached && !cached.isStale) {
      return cached.value;
    }

    // 2. Запросить у глобального сервера
    const result = await this.globalClient.request('searchSymbols', {
      query: args.query,
      monorepoId: this.monorepoContext.monorepoId,  // Контекст
      includeExternal: args.includeExternal ?? false
    });

    // 3. Кешировать
    await this.localCache.set(`symbols:search:${args.query}`, result, {
      ttl: 3600  // 1 hour
    });

    return result;
  }

  private async searchDocumentation(args: any): Promise<any> {
    // Поиск может быть:
    // - Локальный (только этот монорепозиторий)
    // - Глобальный (все монорепозитории)
    // - По зависимостям (только проекты, от которых зависим)

    const scope = args.scope ?? 'dependencies';  // 'local' | 'dependencies' | 'global'

    if (scope === 'local') {
      // Только локальный кеш
      return await this.localCache.searchDocs(args.query);
    }

    // Запрос к глобальному серверу
    return await this.globalClient.request('searchDocumentation', {
      query: args.query,
      scope,
      monorepoId: this.monorepoContext.monorepoId
    });
  }
}
```

### Локальный Кеш

```typescript
class LocalCache {
  private db: RocksDB;
  private syncState: SyncState;

  constructor(monorepoPath: string) {
    const cachePath = join(monorepoPath, '.meridian', 'cache.db');
    this.db = new RocksDB(cachePath);
  }

  // Cache operations
  async get(key: string): Promise<CachedItem | null>
  async set(key: string, value: any, options?: CacheOptions): Promise<void>
  async invalidate(key: string): Promise<void>
  async invalidatePattern(pattern: string): Promise<void>

  // Sync with global DB
  async sync(): Promise<void> {
    const lastSync = await this.syncState.getLastSync();
    const changes = await this.globalClient.getChanges(lastSync);

    for (const change of changes) {
      await this.applyChange(change);
    }

    await this.syncState.setLastSync(new Date());
  }
}

interface CachedItem {
  value: any;
  timestamp: Date;
  ttl?: number;
  isStale: boolean;
}

interface SyncState {
  lastSync: Date;
  pendingChanges: PendingChange[];
}
```

### Запуск MCP Сервера

**Для Claude Code** (в `.claude.json`):
```json
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "cwd": "/path/to/monorepo",
      "env": {
        "MERIDIAN_GLOBAL_SERVER": "http://localhost:7878"
      }
    }
  }
}
```

**Процесс запуска:**
```bash
cd /path/to/monorepo
meridian serve --stdio

# Это:
# 1. Определяет monorepoId
# 2. Подключается к глобальному серверу
# 3. Загружает локальный кеш
# 4. Запускает MCP сервер
# 5. Готов к запросам от Claude Code
```

---

## Кросс-Монорепозиторная Документация

### Use Case

**Сценарий:**
```
Монорепозиторий A: frontend-app
  └── packages/ui-kit
      └── depends on: @company/auth-lib

Монорепозиторий B: backend-services
  └── packages/auth-lib
```

**Задача:** При работе над `ui-kit`, получить документацию для `auth-lib` из другого монорепозитория.

### Решение

**1. Dependency Resolution:**

```typescript
// В packages/ui-kit/package.json
{
  "dependencies": {
    "@company/auth-lib": "^1.0.0"
  }
}

// Meridian:
// 1. Определяет, что ui-kit зависит от auth-lib
// 2. Ищет auth-lib в глобальном реестре
// 3. Находит, что auth-lib в монорепозитории B
// 4. Загружает документацию из глобальной БД
```

**2. MCP Tool Usage:**

```typescript
// В Claude Code, при работе над ui-kit

// Запрос документации для внешней зависимости
const docs = await mcp.request('strong.catalog.get_project', {
  projectId: '@company/auth-lib'
});

// Результат содержит:
// - Документацию для всех exported symbols
// - Примеры использования
// - Cross-references
// - Местоположение исходного кода (для анализа)
```

**3. Source Code Analysis:**

```typescript
// Опционально: анализ исходного кода зависимости
const sourceCode = await mcp.request('code.get_definition', {
  projectId: '@company/auth-lib',
  symbolName: 'authenticate'
});

// Возвращает:
// - Полный исходный код функции
// - Type signature
// - JSDoc документацию
// - Location в файловой системе
```

### Безопасность и Изоляция

**Ограничения:**
- ✅ Чтение документации из других монорепозиториев - разрешено
- ✅ Чтение исходного кода - разрешено (read-only)
- ❌ Изменение кода в других монорепозиториях - запрещено
- ❌ Генерация документации для других проектов - запрещено (только для текущего монорепозитория)

**Реализация:**
```typescript
class SecurityContext {
  currentMonorepoId: string;

  canRead(projectId: string): boolean {
    // Можем читать любой проект
    return true;
  }

  canWrite(projectId: string): boolean {
    // Можем писать только в проекты текущего монорепозитория
    const project = await this.registry.get(projectId);
    return project.monorepo?.id === this.currentMonorepoId;
  }
}
```

### Кеширование Внешних Зависимостей

**Стратегия:**
```typescript
// При первом обращении к внешней зависимости
const docs = await this.globalClient.getDocumentation('@company/auth-lib');

// Кешируем локально
await this.localCache.set('external:@company/auth-lib:docs', docs, {
  ttl: 86400  // 24 hours
});

// Последующие обращения - из локального кеша
const cached = await this.localCache.get('external:@company/auth-lib:docs');
```

---

## Синхронизация и Кеширование

### Стратегия Синхронизации

**Направления синхронизации:**

```
Local Changes (Монорепозиторий)
        ↓
  [Watch файлов]
        ↓
  Global Server
        ↓
  [Индексация]
        ↓
  Global DB
        ↓
  [Push к другим MCP серверам]
        ↓
  Other Local Caches (при запросе)
```

### Типы Синхронизации

**1. Push Sync (от локального к глобальному):**
```typescript
// При изменении файла в монорепозитории
async function onFileChange(filePath: string) {
  // 1. Локальная переиндексация
  const symbols = await parseFile(filePath);

  // 2. Отправка в глобальный сервер
  await globalClient.updateSymbols(projectId, symbols);

  // 3. Глобальный сервер обновляет БД
  await globalDB.put(`symbols:${projectId}:${symbolId}`, symbols);

  // 4. Уведомление других MCP серверов (если они используют этот проект)
  await notifyDependents(projectId, symbolId);
}
```

**2. Pull Sync (от глобального к локальному):**
```typescript
// При запросе документации для внешнего проекта
async function getExternalDocs(projectId: string) {
  // 1. Проверить локальный кеш
  const cached = await localCache.get(`external:${projectId}:docs`);
  if (cached && !cached.isStale) {
    return cached.value;
  }

  // 2. Запросить у глобального сервера
  const docs = await globalClient.getDocumentation(projectId);

  // 3. Кешировать локально
  await localCache.set(`external:${projectId}:docs`, docs, { ttl: 86400 });

  return docs;
}
```

**3. Periodic Sync:**
```typescript
// Периодическая синхронизация (каждые 5 минут)
setInterval(async () => {
  await localCache.sync();
}, 5 * 60 * 1000);
```

### Cache Invalidation

**Триггеры инвалидации:**

**1. File Change:**
```typescript
// Файл изменился
onFileChange('packages/titan/src/application.ts') →
  invalidate('symbols:@omnitron-dev/titan:Application')
```

**2. Project Re-index:**
```typescript
// Проект переиндексирован
onProjectReindex('@omnitron-dev/titan') →
  invalidatePattern('symbols:@omnitron-dev/titan:*')
```

**3. TTL Expiration:**
```typescript
// TTL истек для кеша
onTTLExpire('external:@company/auth-lib:docs') →
  markStale('external:@company/auth-lib:docs')
```

**4. Manual Invalidation:**
```bash
# Очистка локального кеша
meridian cache clear

# Очистка для конкретного проекта
meridian cache clear --project "@omnitron-dev/titan"
```

### Offline Mode

**Работа без глобального сервера:**

```typescript
class MeridianMCPServer {
  private offlineMode: boolean = false;

  async handleToolCall(tool: string, args: any) {
    try {
      // Попытка обращения к глобальному серверу
      return await this.handleWithGlobalServer(tool, args);
    } catch (error) {
      if (isConnectionError(error)) {
        // Переключение в offline mode
        this.offlineMode = true;
        console.warn('Global server unavailable, switching to offline mode');

        // Работа только с локальным кешем
        return await this.handleWithLocalCache(tool, args);
      }
      throw error;
    }
  }

  private async handleWithLocalCache(tool: string, args: any) {
    // Ограниченная функциональность:
    // - Только проекты текущего монорепозитория
    // - Только закешированные внешние зависимости
    // - Генерация документации работает

    const result = await this.localCache.query(tool, args);

    if (!result) {
      throw new Error(
        'Data not available in offline mode. ' +
        'Please reconnect to global server or work with local projects only.'
      );
    }

    return result;
  }
}
```

---

## RocksDB Schema

### Глобальная БД Schema

**Расположение:** `~/.meridian/data/`

```
# Project Registry
registry:projects:{fullId}                    → ProjectRegistry (JSON)
registry:index:name:{projectName}             → fullId[]
registry:index:monorepo:{monorepoId}          → fullId[]
registry:index:path:{pathHash}                → fullId

# Monorepo Registry
registry:monorepos:{monorepoId}               → MonorepoInfo (JSON)
registry:monorepos:index:path:{pathHash}      → monorepoId

# Symbols (все символы из всех проектов)
symbols:{projectFullId}:{symbolId}            → ExtractedSymbol (JSON)
symbols:index:name:{symbolName}               → {projectFullId:symbolId}[]
symbols:index:kind:{kind}:{projectFullId}     → symbolId[]

# Documentation
docs:{projectFullId}:{symbolId}               → GeneratedDocumentation (JSON)
docs:quality:{projectFullId}:{symbolId}       → DocumentationQuality (JSON)

# Examples
examples:{projectFullId}:{symbolId}           → GeneratedExample[] (JSON)
examples:validation:{projectFullId}:{symbolId}→ ExampleValidation (JSON)

# Tests
tests:{projectFullId}:{symbolId}              → GeneratedTest[] (JSON)
tests:validation:{projectFullId}:{symbolId}   → TestValidation (JSON)

# Cross-References (кросс-монорепозиторные ссылки)
xref:{sourceFullId}:{targetFullId}            → CrossReference[] (JSON)
xref:incoming:{targetFullId}                  → IncomingReference[] (JSON)
xref:outgoing:{sourceFullId}                  → OutgoingReference[] (JSON)

# Dependencies (граф зависимостей)
deps:incoming:{projectFullId}                 → DependentProject[] (JSON)
deps:outgoing:{projectFullId}                 → DependencyProject[] (JSON)
deps:graph                                    → GlobalDependencyGraph (JSON)

# Metadata
meta:index_version                            → string
meta:last_global_sync                         → timestamp
meta:statistics                               → GlobalStatistics (JSON)
```

### Локальная БД Schema

**Расположение:** `[monorepo-path]/.meridian/cache.db/`

```
# Local Cache (символы текущего монорепозитория)
cache:symbols:{projectId}:{symbolId}          → CachedSymbol (JSON)
cache:docs:{projectId}:{symbolId}             → CachedDocumentation (JSON)

# External Cache (кеш внешних зависимостей)
cache:external:{externalProjectId}:docs       → ExternalDocs (JSON)
cache:external:{externalProjectId}:symbols    → ExternalSymbols (JSON)

# Query Cache (кеш результатов запросов)
cache:query:search:{queryHash}                → SearchResult (JSON)
cache:query:xref:{symbolId}                   → CrossReference[] (JSON)

# Sync State
sync:last_sync                                → timestamp
sync:pending_changes                          → PendingChange[] (JSON)

# Metadata
meta:monorepo_id                              → string
meta:cache_version                            → string
```

### Примеры Ключей

```
# Global DB
registry:projects:@omnitron-dev/titan@1.0.0   → {...}
symbols:@omnitron-dev/titan@1.0.0:Application → {...}
docs:@omnitron-dev/titan@1.0.0:Application    → {...}
xref:@omnitron-dev/titan@1.0.0:@omnitron-dev/common@1.0.0 → [...]

# Local Cache
cache:symbols:titan:Application               → {...}
cache:external:@company/auth-lib@1.0.0:docs   → {...}
sync:last_sync                                → "2025-10-18T12:30:00Z"
```

---

## Конфигурация

### Глобальный Конфиг

**Расположение:** `~/.meridian/meridian.toml`

```toml
[server]
# Глобальный сервер
host = "localhost"
port = 7878
daemon = true
auto_start = true  # Автозапуск при первом обращении

[storage]
# Хранилище
data_dir = "~/.meridian/data"
cache_size_mb = 1024
max_db_size_mb = 10240
compression = "zstd"

[indexing]
# Индексация
auto_index_on_add = true
watch_enabled = true
debounce_ms = 500
max_concurrent_indexes = 4

[cross_monorepo]
# Кросс-монорепозиторная функциональность
enable = true
cache_external_docs = true
max_dependency_depth = 3
auto_discover_dependencies = true

[cache]
# Глобальный кеш
default_ttl_hours = 24
max_cache_size_mb = 2048
eviction_policy = "lru"

[file_watching]
# File watching
enabled = true
ignore_patterns = [
  "node_modules",
  "target",
  "dist",
  ".git",
  "*.log"
]
batch_delay_ms = 500

[logging]
# Логирование
level = "info"
file = "~/.meridian/logs/server.log"
max_size_mb = 100
max_backups = 5

[security]
# Безопасность (future)
enable_access_control = false
allowed_monorepos = []  # Empty = all allowed
```

### Локальный Конфиг

**Расположение:** `[monorepo-path]/.meridian/meridian.toml`

```toml
[monorepo]
# Идентификация монорепозитория
id = "omnitron-dev"
name = "Omnitron Development"
type = "pnpm"  # pnpm | npm | yarn | cargo | mixed

[projects]
# Проекты (auto-discovery если не указано)
auto_discover = true
# Явное указание (опционально):
# explicit = [
#   "packages/titan",
#   "packages/common"
# ]

[sync]
# Синхронизация с глобальной БД
auto_sync = true
sync_interval_minutes = 5
sync_on_file_change = true
push_immediately = false  # или буферизация

[cache]
# Локальный кеш
enabled = true
max_size_mb = 512
ttl_hours = 24
cache_external_deps = true

[mcp]
# MCP-специфичные настройки
enable_cross_monorepo_docs = true
include_external_sources = true
scope = "dependencies"  # local | dependencies | global

[indexing]
# Локальная индексация
include_tests = true
include_examples = true
exclude_patterns = []
```

---

## CLI Commands

### Глобальные Команды

**Server Management:**
```bash
# Запуск глобального сервера
meridian server start [--daemon]

# Остановка
meridian server stop

# Статус
meridian server status

# Логи
meridian server logs [--follow]

# Restart
meridian server restart
```

**Project Management:**
```bash
# Добавить монорепозиторий
meridian projects add <path>

# Список всех проектов
meridian projects list [--monorepo <id>]

# Поиск проекта
meridian projects search <query>

# Детали проекта
meridian projects info <project-id>

# Удаление проекта
meridian projects remove <project-id>

# Перемещение монорепозитория
meridian projects relocate <monorepo-id> <new-path>
```

**Indexing:**
```bash
# Индексация всех проектов
meridian index --all

# Индексация конкретного проекта
meridian index --project <project-id>

# Индексация монорепозитория
meridian index --monorepo <monorepo-id>

# Re-index (force)
meridian index --force --project <project-id>
```

**Cache Management:**
```bash
# Статистика кеша
meridian cache stats

# Очистка глобального кеша
meridian cache clear --global

# Очистка для проекта
meridian cache clear --project <project-id>

# Очистка всех локальных кешей
meridian cache clear --all-local
```

**Diagnostics:**
```bash
# Проверка целостности БД
meridian doctor

# Статистика
meridian stats

# Dependency graph
meridian deps graph <project-id>

# Dependency tree
meridian deps tree <project-id> [--depth <n>]
```

### Локальные Команды (в контексте монорепозитория)

**MCP Server:**
```bash
# Запуск MCP сервера для Claude Code
meridian serve --stdio

# Запуск с дополнительными опциями
meridian serve --stdio --verbose --offline
```

**Local Operations:**
```bash
# Инициализация .meridian в монорепозитории
meridian init

# Локальная индексация
meridian index

# Синхронизация с глобальной БД
meridian sync

# Статус локального кеша
meridian cache status

# Очистка локального кеша
meridian cache clear
```

---

## MCP Tools

### Обновленные Tools для Кросс-Монорепозиторной Работы

**Новые категории:**
1. **Global Catalog Tools** - работа с глобальным реестром
2. **Cross-Monorepo Tools** - кросс-монорепозиторная функциональность

### Global Catalog Tools

#### `strong.global.list_monorepos`

**Description**: Список всех зарегистрированных монорепозиториев.

**Input**: None

**Output**:
```typescript
{
  monorepos: {
    id: string;
    name: string;
    path: string;
    type: "pnpm" | "npm" | "cargo" | "mixed";
    projectCount: number;
    lastIndexed: Date;
  }[];
  totalProjects: number;
}
```

---

#### `strong.global.search_all_projects`

**Description**: Поиск проектов across all monorepos.

**Input**:
```typescript
{
  query: string;                        // Search query
  monorepoId?: string;                  // Filter by monorepo
  type?: "typescript" | "rust";
}
```

**Output**:
```typescript
{
  results: {
    projectId: string;
    name: string;
    monorepo: {
      id: string;
      name: string;
      path: string;
    };
    documentationCoverage: number;
    lastIndexed: Date;
  }[];
  totalResults: number;
}
```

---

#### `strong.global.get_dependency_graph`

**Description**: Граф зависимостей (кросс-монорепозиторный).

**Input**:
```typescript
{
  projectId: string;
  depth?: number;                       // Default: 3
  direction: "incoming" | "outgoing" | "both";
  includeExternal?: boolean;            // Include npm registry deps
}
```

**Output**:
```typescript
{
  graph: {
    nodes: {
      id: string;
      type: "project" | "external";
      monorepo?: {
        id: string;
        path: string;
      };
    }[];
    edges: {
      from: string;
      to: string;
      type: "dependency" | "devDependency";
      version: string;
    }[];
  };
  visualization: string;                // Mermaid diagram
}
```

---

### Cross-Monorepo Documentation Tools

#### `strong.external.get_documentation`

**Description**: Получить документацию для внешнего проекта (из другого монорепозитория).

**Input**:
```typescript
{
  projectId: string;                    // "@company/auth-lib"
  symbolName?: string;                  // Specific symbol
  includeExamples?: boolean;
  includeSource?: boolean;              // Include source code
}
```

**Output**:
```typescript
{
  project: {
    id: string;
    monorepo: {
      id: string;
      path: string;
    };
    version: string;
  };
  documentation: {
    symbols: {
      name: string;
      documentation: string;
      examples?: GeneratedExample[];
      source?: string;
    }[];
  };
  fromCache: boolean;                   // Из локального кеша или глобальной БД
}
```

---

#### `strong.external.find_usages`

**Description**: Найти использования символа across all monorepos.

**Input**:
```typescript
{
  projectId: string;
  symbolName: string;
  includeTests?: boolean;
}
```

**Output**:
```typescript
{
  usages: {
    projectId: string;
    monorepo: {
      id: string;
      name: string;
    };
    location: SourceLocation;
    context: string;                    // Surrounding code
    usageType: "import" | "call" | "extend" | "implement";
  }[];
  totalUsages: number;
}
```

---

### Обновленные Существующие Tools

**`strong.catalog.search_documentation`** - теперь поддерживает scope:

**Input** (updated):
```typescript
{
  query: string;
  scope?: "local" | "dependencies" | "global";  // NEW
  minQuality?: number;
  limit?: number;
}
```

- `scope: "local"` - только текущий монорепозиторий
- `scope: "dependencies"` - текущий монорепозиторий + его зависимости
- `scope: "global"` - все монорепозитории на машине

---

## Workflows и Use Cases

### Workflow 1: Добавление Нового Монорепозитория

```bash
# 1. Запустить глобальный сервер (если не запущен)
meridian server start --daemon

# 2. Добавить монорепозиторий
meridian projects add /Users/dev/work/frontend-monorepo

# Что происходит:
# - Сканирование workspace
# - Обнаружение всех проектов (packages/*)
# - Регистрация в глобальном реестре
# - Индексация всех проектов
# - Запуск file watching

# 3. Проверить статус
meridian projects list

# Output:
# Monorepo: frontend-app (pnpm)
#   Path: /Users/dev/work/frontend-monorepo
#   Projects: 5
#     - @company/ui-kit (TypeScript)
#     - @company/components (TypeScript)
#     - @company/utils (TypeScript)
#     - ...
#   Last indexed: 2 minutes ago
```

### Workflow 2: Работа с Claude Code (Кросс-Монорепозиторная Документация)

```typescript
// Пользователь работает над @company/ui-kit в frontend-monorepo
// ui-kit зависит от @company/auth-lib из backend-monorepo

// 1. Claude Code запускает meridian serve --stdio
//    в контексте frontend-monorepo

// 2. При работе над кодом, который использует auth-lib:
import { authenticate } from '@company/auth-lib';

// 3. Claude Code запрашивает документацию через MCP:
const docs = await mcp.request('strong.external.get_documentation', {
  projectId: '@company/auth-lib',
  symbolName: 'authenticate',
  includeExamples: true
});

// 4. Meridian MCP Server:
//    - Проверяет локальный кеш
//    - Если нет - запрашивает у глобального сервера
//    - Глобальный сервер находит auth-lib в backend-monorepo
//    - Возвращает документацию
//    - MCP Server кеширует локально

// 5. Claude Code получает:
//    - Полную документацию функции authenticate
//    - Примеры использования
//    - Информацию о типах
//    - Опционально: исходный код

// 6. Claude Code может использовать эту информацию для:
//    - Правильного использования API
//    - Генерации корректного кода
//    - Подсказок пользователю
```

### Workflow 3: Перемещение Монорепозитория

```bash
# Исходная ситуация
/Users/dev/work/frontend-monorepo  # Старый путь

# 1. Переместить директорию
mv /Users/dev/work/frontend-monorepo /Users/dev/projects/frontend-monorepo

# 2. Обновить реестр
meridian projects relocate frontend-app /Users/dev/projects/frontend-monorepo

# Что происходит:
# - Обновление путей в project registry
# - Сохранение истории перемещений
# - Переиндексация НЕ требуется (ID остается тот же)
# - File watcher обновляет watched paths
# - Локальные кеши других монорепозиториев не затронуты

# 3. Проверка
meridian projects info frontend-app

# Output:
# Project: frontend-app
#   Current Path: /Users/dev/projects/frontend-monorepo
#   History:
#     - /Users/dev/work/frontend-monorepo (2025-10-15, relocated)
#     - /Users/dev/projects/frontend-monorepo (2025-10-18, current)
```

### Workflow 4: Оффлайн Работа

```bash
# Глобальный сервер недоступен (выключен или ошибка)

# 1. Запуск MCP сервера
cd /Users/dev/work/frontend-monorepo
meridian serve --stdio

# Output:
# Warning: Global server unavailable, running in offline mode
# Limited functionality:
#   - Local projects: full access
#   - External deps: cached only
#   - Doc generation: available

# 2. Работа с локальными проектами - полностью функционально
const localDocs = await mcp.request('strong.docs.generate', {
  targetPath: 'packages/ui-kit/src/button.ts'
});
// ✅ Работает (локальный проект)

# 3. Попытка получить документацию для внешнего проекта
const externalDocs = await mcp.request('strong.external.get_documentation', {
  projectId: '@company/auth-lib'
});
// ✅ Работает, если есть в локальном кеше
// ❌ Ошибка, если не в кеше и глобальный сервер недоступен

# 4. Когда глобальный сервер снова доступен
# - Автоматическая синхронизация pending changes
# - Обновление кеша
# - Полная функциональность восстановлена
```

---

## Миграция и Совместимость

### Миграция от Single-Monorepo к Global Architecture

**Phase 1: Подготовка**

```bash
# 1. Установить обновленную версию Meridian
npm install -g meridian@2.0.0

# 2. Инициализировать глобальную директорию
meridian init --global

# Создает:
# - ~/.meridian/
# - ~/.meridian/meridian.toml (с дефолтными настройками)
# - ~/.meridian/data/ (пустая глобальная БД)
```

**Phase 2: Миграция Существующих Данных**

```bash
# 3. Мигрировать существующий монорепозиторий
cd /path/to/existing/monorepo
meridian migrate --to-global

# Что происходит:
# - Чтение данных из .meridian/local.db (старый формат)
# - Конвертация в новый формат
# - Загрузка в ~/.meridian/data/ (глобальная БД)
# - Создание .meridian/cache.db (новый локальный кеш)
# - Регистрация монорепозитория в project registry
# - Сохранение старой БД как backup (.meridian/local.db.backup)

# 4. Проверка миграции
meridian projects list

# Output должен показать мигрированный монорепозиторий
```

**Phase 3: Обновление Конфигурации**

```bash
# 5. Обновить .claude.json для Claude Code
# Старый формат:
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["mcp"]  # Старая команда
    }
  }
}

# Новый формат:
{
  "mcpServers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"]  # Новая команда
    }
  }
}
```

### Обратная Совместимость

**Поддержка Старых Команд:**
```bash
# Старая команда
meridian mcp

# Автоматически перенаправляется на:
meridian serve --stdio --legacy-mode

# С предупреждением:
# Warning: 'meridian mcp' is deprecated. Use 'meridian serve --stdio' instead.
```

**Поддержка Старого Формата БД:**
- Meridian 2.0 может читать старые БД (v1.x)
- Автоматическая миграция при первом запуске
- Сохранение backup старой БД

### Версионирование

**Semantic Versioning:**
- `v1.x.x` - Single-monorepo architecture
- `v2.x.x` - Global architecture (текущая спецификация)

**Compatibility Matrix:**
```
Meridian v1.x → v2.x: ✅ Автоматическая миграция
Meridian v2.x → v1.x: ❌ Не поддерживается (breaking changes)

MCP Protocol:
  v2024-11-05: ✅ Поддерживается (legacy)
  v2025-03-26: ✅ Поддерживается (current)
```

---

## План Реализации

### Phase 1: Infrastructure (Weeks 1-2)

**Tasks:**
1. ✅ **Global Architecture Spec** (этот документ)
2. **Global Server Implementation**:
   - Project registry manager
   - Global RocksDB setup
   - IPC server (HTTP-based)
   - CLI commands (server, projects, index)
3. **Project Identity System**:
   - ID generation (npm, cargo, generic)
   - Content hashing
   - Path tracking
4. **Migration Tools**:
   - v1.x → v2.x migration script
   - Data converter

**Deliverables:**
- Global server functional
- Can register and manage monorepos
- Migration from v1.x works

---

### Phase 2: Local MCP Server (Weeks 3-4)

**Tasks:**
1. **MCP Server Implementation**:
   - Client to global server
   - Local cache (RocksDB)
   - STDIO transport for Claude Code
2. **Sync Mechanism**:
   - Push sync (local → global)
   - Pull sync (global → local)
   - Cache invalidation
3. **Offline Mode**:
   - Graceful degradation when global server unavailable
   - Local-only functionality

**Deliverables:**
- MCP server works with Claude Code
- Can access both local and external docs
- Offline mode functional

---

### Phase 3: Cross-Monorepo Features (Weeks 5-6)

**Tasks:**
1. **Dependency Resolution**:
   - Parse package.json/Cargo.toml dependencies
   - Build dependency graph (cross-monorepo)
   - Auto-discovery of external dependencies
2. **Cross-Monorepo Documentation**:
   - Fetch docs from external projects
   - Cache external docs locally
   - Security & isolation
3. **MCP Tools**:
   - `strong.global.*` tools
   - `strong.external.*` tools
   - Updated `strong.catalog.*` tools with scope

**Deliverables:**
- Cross-monorepo documentation works
- Dependency graph visualization
- Complete MCP tools for global features

---

### Phase 4: File Watching & Sync (Weeks 7-8)

**Tasks:**
1. **Global File Watcher**:
   - Watch all registered monorepos
   - Debouncing and batching
   - Incremental re-indexing
2. **Sync Optimization**:
   - Efficient change propagation
   - Minimize re-indexing
   - Smart cache updates
3. **Notifications**:
   - Notify dependent MCP servers of changes
   - Push updates to local caches

**Deliverables:**
- Auto-update works across monorepos
- Low-latency change propagation
- Efficient resource usage

---

### Phase 5: Integration with Strong Tools (Weeks 9-10)

**Tasks:**
1. **Documentation Generation** (from strong-tools-spec.md):
   - Integrate with global architecture
   - Generate docs for any project
   - Cross-project doc generation
2. **Example & Test Generation**:
   - Generate examples for external deps
   - Validate examples across monorepos
3. **Agent Integration**:
   - Architect, Developer, Tester agents
   - Work with global project registry

**Deliverables:**
- Strong Tools fully integrated
- Can generate docs for any project
- Agent workflows functional

---

### Phase 6: Testing & Polish (Weeks 11-12)

**Tasks:**
1. **Comprehensive Testing**:
   - Unit tests for all components
   - Integration tests (cross-monorepo scenarios)
   - MCP tool tests
   - Migration tests (v1 → v2)
2. **Performance Optimization**:
   - Cache tuning
   - Query optimization
   - Indexing performance
3. **Documentation**:
   - User guide
   - Migration guide
   - API documentation
   - Best practices

**Deliverables:**
- Production-ready v2.0.0
- Complete documentation
- Migration path clear

---

### Phase 7: Launch & Support (Week 13+)

**Tasks:**
1. **Release v2.0.0**:
   - Publish to npm
   - Release notes
   - Migration guide
2. **Community Support**:
   - GitHub issues
   - Discord/Slack
   - Documentation updates
3. **Post-Launch Features**:
   - Plugin system
   - Remote server support (multi-machine)
   - Role-based access control

---

## Заключение

**Meridian Global Architecture v2.0** трансформирует Meridian в **полноценную глобальную систему управления знаниями** для разработчиков, работающих с множеством монорепозиториев:

✅ **Глобальный реестр проектов** - единая база всех проектов на машине
✅ **Устойчивые к перемещению ID** - проекты можно переносить без потери данных
✅ **Кросс-монорепозиторная документация** - доступ к документации из любого проекта
✅ **Двухуровневое хранилище** - глобальная БД + локальные кеши
✅ **Клиент-серверная архитектура** - масштабируемость и эффективность
✅ **Автоматическая синхронизация** - изменения распространяются автоматически
✅ **Оффлайн режим** - работа без глобального сервера
✅ **Полная совместимость** с существующими спецификациями (spec.md, strong-tools-spec.md)

**Architecture Highlights:**
- **Local-First, Global-Enhanced** - быстрый локальный доступ + глобальные возможности
- **Identity-Based, Not Path-Based** - устойчивость к перемещениям
- **Layered & Modular** - чистая архитектура, легко расширяется
- **Secure & Isolated** - безопасность через read-only доступ к внешним проектам

**Total MCP Tools:** 29 (existing) + 23 (strong tools) + 5 (global tools) = **57 tools**

**Ready for Implementation** → [Plan](#план-реализации)

---

**Next Steps:**
1. Approve this specification
2. Start Phase 1 implementation
3. Create GitHub project for tracking
4. Set up CI/CD for v2.0.0

**Questions/Feedback:** [GitHub Issues](https://github.com/yourusername/meridian/issues)
