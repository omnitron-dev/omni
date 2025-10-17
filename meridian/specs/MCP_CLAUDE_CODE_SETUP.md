# Meridian MCP Server - Инструкция по подключению к Claude Code

## Обзор

Meridian - это когнитивная система памяти для LLM, которая предоставляет интеллектуальное управление контекстом, обучение на основе опыта и адаптивную работу с кодовыми базами через протокол MCP (Model Context Protocol).

## Предварительные требования

1. **Rust** (версия 1.70 или выше)
2. **Cargo** (менеджер пакетов Rust)
3. **Claude Code** (последняя версия)
4. **Git** (для клонирования репозитория)

## Шаг 1: Установка Meridian

### 1.1 Клонирование репозитория

```bash
cd /Users/taaliman/projects/luxquant/omnitron-dev/omni
cd meridian
```

### 1.2 Сборка проекта

```bash
# Установка зависимостей и сборка
cargo build --release

# Проверка успешной сборки
./target/release/meridian --version
```

### 1.3 Создание символической ссылки (опционально)

Для удобства можно создать символическую ссылку в директории с бинарными файлами:

```bash
# Создание ссылки в локальной bin директории
mkdir -p ~/.local/bin
ln -s $(pwd)/target/release/meridian ~/.local/bin/meridian

# Добавление в PATH (если еще не добавлено)
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.zshrc
source ~/.zshrc
```

## Шаг 2: Первоначальная настройка Meridian

### 2.1 Инициализация индекса

Перед первым использованием необходимо проиндексировать вашу кодовую базу:

```bash
# Инициализация Meridian в корне проекта
cd /path/to/your/project
meridian init .

# Индексирование проекта
meridian index .

# Проверка статистики индекса
meridian stats
```

### 2.2 Конфигурация Meridian

Отредактируйте файл `meridian.toml` в корне вашего проекта:

```toml
# meridian.toml
[index]
languages = ["rust", "typescript", "javascript", "python", "go"]
ignore = ["node_modules", "target", ".git", "dist", "build"]
max_file_size = "1MB"

[storage]
path = ".meridian/index"
cache_size = "256MB"

[memory]
episodic_retention_days = 30
working_memory_size = "10MB"
consolidation_interval = "1h"

[session]
max_sessions = 10
session_timeout = "1h"

[monorepo]
detect_projects = true
project_markers = ["Cargo.toml", "package.json", "tsconfig.json", "go.mod", "pyproject.toml"]

[learning]
min_episodes_for_pattern = 3
confidence_threshold = 0.7

[mcp]
max_token_response = 2000
log_level = "info"
```

## Шаг 3: Настройка Claude Code

### 3.1 Создание конфигурации MCP

Создайте файл `.claude/mcp_config.json` в корне вашего проекта:

```json
{
  "servers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio"],
      "env": {
        "MERIDIAN_CONFIG": "./meridian.toml",
        "RUST_LOG": "info"
      }
    }
  }
}
```

### 3.2 Альтернативная конфигурация с полным путем

Если Meridian не в PATH, используйте полный путь:

```json
{
  "servers": {
    "meridian": {
      "command": "/Users/taaliman/projects/luxquant/omnitron-dev/omni/meridian/target/release/meridian",
      "args": ["serve", "--stdio"],
      "env": {
        "MERIDIAN_CONFIG": "./meridian.toml",
        "RUST_LOG": "info"
      }
    }
  }
}
```

### 3.3 Конфигурация для отладки

Для детальной отладки используйте следующую конфигурацию:

```json
{
  "servers": {
    "meridian": {
      "command": "meridian",
      "args": ["serve", "--stdio", "--debug"],
      "env": {
        "MERIDIAN_CONFIG": "./meridian.toml",
        "RUST_LOG": "debug,meridian=trace",
        "RUST_BACKTRACE": "1"
      }
    }
  }
}
```

## Шаг 4: Проверка подключения

### 4.1 Тестирование MCP сервера

Проверьте работу сервера в терминале:

```bash
# Запуск в интерактивном режиме для тестирования
echo '{"jsonrpc":"2.0","method":"initialize","params":{},"id":1}' | meridian serve --stdio

# Ожидаемый ответ:
# {"jsonrpc":"2.0","result":{"protocolVersion":"2024-11-05","serverInfo":{"name":"meridian","version":"0.1.0"},"capabilities":{"tools":{},"resources":{},"prompts":{}}},"id":1}
```

### 4.2 Проверка в Claude Code

1. Перезапустите Claude Code после создания конфигурации
2. Откройте проект с файлом `.claude/mcp_config.json`
3. В Claude Code должны появиться новые инструменты Meridian

## Шаг 5: Использование инструментов Meridian

### Доступные инструменты

После успешного подключения вам будут доступны следующие инструменты:

#### Управление памятью
- `memory.record_episode` - Запись эпизода работы
- `memory.find_similar_episodes` - Поиск похожих задач
- `memory.update_working_set` - Обновление рабочего набора

#### Управление контекстом
- `context.prepare_adaptive` - Подготовка адаптивного контекста
- `context.defragment` - Дефрагментация контекста

#### Навигация по коду
- `code.search_symbols` - Поиск символов
- `code.get_definition` - Получение определения
- `code.find_references` - Поиск использований
- `code.get_dependencies` - Граф зависимостей

#### Управление сессиями
- `session.begin` - Начало новой сессии
- `session.update` - Обновление файла в сессии
- `session.query` - Запрос в контексте сессии
- `session.complete` - Завершение сессии

### Примеры использования в Claude Code

```typescript
// Поиск похожих задач
await mcp.call("meridian", "memory.find_similar_episodes", {
  task_description: "Add authentication middleware",
  limit: 3
});

// Поиск символов с ограничением токенов
await mcp.call("meridian", "code.search_symbols", {
  query: "PaymentService",
  max_tokens: 1000,
  type: ["class", "interface"]
});

// Начало рабочей сессии
await mcp.call("meridian", "session.begin", {
  task_description: "Refactor payment module",
  scope: ["src/services/payment/"]
});
```

## Шаг 6: Отладка

### 6.1 Просмотр логов

Логи Meridian сохраняются в `.meridian/logs/`:

```bash
# Просмотр последних логов
tail -f .meridian/logs/meridian.log

# Просмотр логов MCP сервера
tail -f .meridian/logs/mcp_server.log
```

### 6.2 Частые проблемы и решения

#### Проблема: "Command not found: meridian"

**Решение**: Используйте полный путь к бинарному файлу в конфигурации MCP или добавьте meridian в PATH.

#### Проблема: "Failed to initialize index"

**Решение**: Убедитесь, что вы запустили `meridian init` и `meridian index` в корне проекта.

#### Проблема: "Connection timeout"

**Решение**: Проверьте, что сервер запускается без ошибок:
```bash
meridian serve --stdio --debug
```

#### Проблема: "Tools not showing in Claude Code"

**Решение**:
1. Проверьте корректность `.claude/mcp_config.json`
2. Перезапустите Claude Code
3. Убедитесь, что вы находитесь в проекте с конфигурацией

### 6.3 Включение детальной отладки

Для максимально подробной отладки:

```bash
# Установка переменных окружения
export RUST_LOG=trace
export RUST_BACKTRACE=full

# Запуск сервера с отладкой
meridian serve --stdio --debug 2> meridian_debug.log
```

## Шаг 7: Обновление и обслуживание

### 7.1 Обновление индекса

Периодически обновляйте индекс для актуальности данных:

```bash
# Полная переиндексация
meridian index . --force

# Инкрементальное обновление
meridian index . --incremental
```

### 7.2 Очистка старых данных

```bash
# Очистка эпизодов старше 30 дней
meridian cleanup --episodes --older-than 30d

# Очистка неиспользуемых сессий
meridian cleanup --sessions
```

### 7.3 Резервное копирование

```bash
# Создание резервной копии индекса
tar -czf meridian_backup_$(date +%Y%m%d).tar.gz .meridian/
```

## Шаг 8: Продвинутые возможности

### 8.1 Обучение на вашей кодовой базе

Meridian обучается на основе вашей работы:

1. **Автоматическое обучение**: Система автоматически запоминает паттерны из успешных решений
2. **Ручная разметка**: Отмечайте полезные решения через `memory.record_episode`
3. **Анализ паттернов**: Используйте `attention.analyze_patterns` для анализа фокуса внимания

### 8.2 Оптимизация производительности

```toml
# Настройки для больших проектов в meridian.toml
[performance]
parallel_indexing = true
max_workers = 8
chunk_size = 100
cache_strategy = "aggressive"

[index]
incremental = true
watch_mode = true
debounce_ms = 500
```

### 8.3 Интеграция с CI/CD

```yaml
# .github/workflows/meridian.yml
name: Update Meridian Index
on:
  push:
    branches: [main]
jobs:
  index:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install Meridian
        run: cargo install --path meridian
      - name: Index codebase
        run: meridian index . --incremental
      - name: Upload index
        uses: actions/upload-artifact@v2
        with:
          name: meridian-index
          path: .meridian/
```

## Поддержка

При возникновении проблем:

1. Проверьте логи в `.meridian/logs/`
2. Запустите диагностику: `meridian diagnose`
3. Создайте issue в репозитории с выводом диагностики

## Заключение

Теперь Meridian полностью интегрирован с Claude Code! Система будет:

- 🧠 Запоминать ваши паттерны работы
- 🔍 Интеллектуально искать по кодовой базе
- 📊 Адаптировать контекст под размер окна модели
- 🚀 Экономить до 95% токенов при сохранении смысла
- 📈 Обучаться и улучшаться с каждым использованием

Приятной работы с Meridian!