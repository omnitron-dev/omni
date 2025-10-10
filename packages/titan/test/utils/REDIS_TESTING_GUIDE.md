# Redis Testing Guide - Автоматический запуск Docker контейнеров

## Проблема

Многие тесты предполагают, что Redis уже запущен на `localhost:6379` и падают, если этого не сделать вручную:

```bash
$ yarn test test/rotif/publish-simple.spec.ts
# ❌ ECONNREFUSED - Redis not running
```

## Решение

Используйте `redis-auto-setup.ts` для автоматического управления Docker контейнерами:

- ✅ Автоматический запуск Redis перед тестами
- ✅ Автоматическая очистка после тестов
- ✅ Изолированные контейнеры для каждого теста (по умолчанию)
- ✅ Динамическое выделение портов (без конфликтов)
- ✅ Работает на macOS, Linux, Windows

---

## Паттерн 1: Изолированный контейнер на каждый тест (Рекомендовано)

Каждый тест получает свой собственный Redis контейнер.

### До:
```typescript
import { createTestConfig } from './helpers/test-utils.js';

describe('My Test', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    // ❌ Предполагает Redis на localhost:6379
    manager = new NotificationManager(createTestConfig(1));
    redis = manager.redis;
    await redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });
});
```

### После:
```typescript
import { setupRedisForTests } from '../utils/redis-auto-setup.js';

describe('My Test', () => {
  // ✅ Автоматический запуск/остановка Redis
  const { getRedisUrl } = setupRedisForTests();

  let manager: NotificationManager;

  beforeEach(async () => {
    // Каждый тест получает свой Redis контейнер
    manager = new NotificationManager({
      redis: getRedisUrl(), // ✅ Динамический URL
      checkDelayInterval: 100,
      blockInterval: 100,
    });
    await manager.redis.flushdb();
  });

  afterEach(async () => {
    await manager.stopAll();
  });
});
```

---

## Паттерн 2: Общий контейнер для всех тестов

Если тестам не нужна изоляция (быстрее, но менее надёжно).

```typescript
import { setupSharedRedisContainer } from '../utils/redis-auto-setup.js';

describe('My Test Suite', () => {
  const redis = setupSharedRedisContainer();

  beforeAll(async () => {
    // Очистка перед всеми тестами
    await redis.getClient().flushdb();
  });

  beforeEach(async () => {
    // Опционально: очистка между тестами
    await redis.getClient().flushdb();
  });

  it('test 1', async () => {
    await redis.getClient().set('key1', 'value1');
  });

  it('test 2', async () => {
    // Может видеть данные из test 1 (общий контейнер)
    const value = await redis.getClient().get('key1');
  });
});
```

---

## Паттерн 3: Прямой доступ к клиенту

Для простых тестов без NotificationManager.

```typescript
import { setupRedisContainer } from '../utils/redis-auto-setup.js';

describe('Simple Redis Test', () => {
  const redis = setupRedisContainer();

  it('should set and get values', async () => {
    const client = redis.getClient();
    await client.set('test-key', 'test-value');
    const result = await client.get('test-key');
    expect(result).toBe('test-value');
  });

  it('should have clean state', async () => {
    // Новый контейнер = чистое состояние
    const client = redis.getClient();
    const keys = await client.keys('*');
    expect(keys.length).toBe(0);
  });
});
```

---

## Паттерн 4: Ручное управление (для сложных случаев)

Используйте `RedisTestManager` напрямую для полного контроля.

```typescript
import { RedisTestManager, RedisTestContainer } from '../utils/redis-test-manager.js';

describe('Advanced Test', () => {
  let testManager: RedisTestManager;
  let container: RedisTestContainer;

  beforeAll(() => {
    testManager = RedisTestManager.getInstance({
      verbose: process.env.REDIS_VERBOSE === 'true',
    });
  });

  beforeEach(async () => {
    container = await testManager.createContainer('my-test');
    // container.url, container.port, container.client доступны
  }, 30000);

  afterEach(async () => {
    await container.cleanup();
  });

  it('should work', async () => {
    await container.client.set('key', 'value');
    expect(await container.client.get('key')).toBe('value');
  });
});
```

---

## Пример миграции: Rotif тест

### До (test/rotif/publish-simple.spec.ts):
```typescript
import Redis from 'ioredis';
import { NotificationManager } from '../../src/rotif/rotif.js';
import { createTestConfig } from './helpers/test-utils.js';

describe('Lua Script - Atomic Publish', () => {
  let manager: NotificationManager;
  let redis: Redis;

  beforeAll(async () => {
    // ❌ Требует предварительно запущенный Redis
    manager = new NotificationManager(createTestConfig(1, { blockInterval: 100 }));
    redis = manager.redis;
    await redis.flushdb();
  });

  afterAll(async () => {
    await manager.stopAll();
  });

  it('should atomically publish messages', async () => {
    const id = await manager.publish('test.channel', { msg: 'hello' });
    expect(typeof id).toBe('string');
  });
});
```

### После:
```typescript
import Redis from 'ioredis';
import { NotificationManager } from '../../src/rotif/rotif.js';
import { setupRedisForTests } from '../utils/redis-auto-setup.js';

describe('Lua Script - Atomic Publish', () => {
  // ✅ Автоматический запуск Redis
  const { getRedisUrl } = setupRedisForTests();

  let manager: NotificationManager;
  let redis: Redis;

  beforeEach(async () => {
    // Каждый тест получает изолированный Redis
    manager = new NotificationManager({
      redis: getRedisUrl(),
      checkDelayInterval: 100,
      blockInterval: 100,
    });
    redis = manager.redis;
    await redis.flushdb();

    // Фиктивный обработчик для активации паттерна
    await manager.subscribe('test.channel', async () => {}, { startFrom: '0' });
    await manager.subscribe('test.delayed', async () => {}, { startFrom: '0' });
  }, 30000); // Увеличенный timeout для Docker

  afterEach(async () => {
    await manager.stopAll();
  });

  it('should atomically publish messages', async () => {
    const id = await manager.publish('test.channel', { msg: 'hello' });
    expect(typeof id).toBe('string');

    const messages = await redis.xrange(`rotif:stream:test.channel`, '-', '+');
    expect(messages.length).toBe(1);
  });
});
```

---

## Важные моменты

### 1. Таймауты

Docker контейнеры требуют времени для запуска. Увеличьте таймауты:

```typescript
beforeEach(async () => {
  // ...
}, 30000); // 30 секунд

afterEach(async () => {
  // ...
}); // используйте default timeout (обычно достаточно)
```

### 2. Verbose режим

Для отладки включите verbose логирование:

```bash
REDIS_VERBOSE=true yarn test test/rotif/publish-simple.spec.ts
```

Или в коде:
```typescript
const redis = setupRedisForTests({ verbose: true });
```

### 3. Очистка данных

- **Изолированный паттерн** (Паттерн 1): Автоматически чистый для каждого теста
- **Общий паттерн** (Паттерн 2): Нужно вручную вызывать `flushdb()`

### 4. Порты

Контейнеры используют динамические порты начиная с `16379`, чтобы избежать конфликтов с локальным Redis.

### 5. Совместимость

Работает с:
- ✅ Node.js 22+
- ✅ macOS (Intel & Apple Silicon)
- ✅ Linux
- ✅ Windows (с Docker Desktop)
- ✅ CI/CD (GitHub Actions, GitLab CI, etc.)

---

## Какой паттерн использовать?

| Сценарий | Рекомендуемый паттерн | Причина |
|----------|----------------------|---------|
| Integration тесты | Паттерн 1 (изолированный) | Надёжная изоляция |
| Unit тесты | Mocks (без Redis) | Быстрее |
| Много быстрых тестов | Паттерн 2 (общий) | Быстрее запуск |
| Тесты с side effects | Паттерн 1 | Избежать утечек |
| Отладка | Паттерн 4 (ручной) | Полный контроль |

---

## Тесты, требующие миграции

### Высокий приоритет (~18 файлов):
```
test/rotif/*.spec.ts - Все Rotif тесты
```

### Средний приоритет (6 файлов):
```
test/integration/integration-sd-*.spec.ts - Integration тесты
```

### Низкий приоритет (3 файла):
```
test/modules/notifications/*.spec.ts - Уже частично мигрированы
```

---

## FAQ

**Q: Нужно ли устанавливать Docker?**
A: Да, Docker должен быть установлен и запущен.

**Q: Что если Docker не доступен?**
A: Тесты упадут с ошибкой "Docker executable not found". Можно использовать локальный Redis как fallback.

**Q: Можно ли использовать локальный Redis вместо Docker?**
A: Да, но не рекомендуется. См. `redis-fallback.ts` для реализации fallback логики.

**Q: Медленно ли это?**
A: Первый запуск ~2-3 секунды. Последующие тесты быстрее благодаря кешированию образов Docker.

**Q: Как запустить конкретный тест?**
A: `yarn test test/rotif/publish-simple.spec.ts` - Redis запустится автоматически.

---

## Заключение

Используйте `redis-auto-setup.ts` для всех новых тестов и мигрируйте существующие по мере необходимости. Это устраняет хрупкую зависимость от ручного запуска Redis и делает тесты независимыми и надёжными.
