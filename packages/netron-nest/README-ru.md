# Netron NestJS Integration

**@omnitron-dev/netron-nest** обеспечивает лёгкую интеграцию распределённого фреймворка **Netron** с приложениями на основе **NestJS**, позволяя легко разрабатывать масштабируемые, надёжные и отказоустойчивые микросервисы.

## 📖 О проекте

Netron NestJS — это мощная альтернатива встроенным транспортам NestJS (таким как gRPC, Kafka, Redis и RabbitMQ), предоставляющая простой и декларативный подход к разработке микросервисов с продвинутым механизмом сервис-дискавери, автоматическим heartbeat и отказоустойчивостью на основе Redis.

---

## 🚀 Особенности

- 🚦 **Сервис-дискавери** на основе Redis с автоматическим heartbeat
- 📡 **RPC и Event Streams** для межсервисного взаимодействия
- 🔧 **Декларативное описание и экспонирование сервисов**
- 🔄 **Прозрачная интеграция** с DI-контейнером NestJS
- 💡 **Автоматическая регистрация и экспозиция сервисов**
- 🔄 **Graceful shutdown** и безопасная обработка ошибок
- 🧪 **Полноценное покрытие тестами**

---

## 📦 Установка

```bash
npm install @omnitron-dev/netron @omnitron-dev/netron-nest
```

---

## 🎯 Пример использования

### Создание микросервиса с Netron

```typescript
import { Module } from '@nestjs/common';
import { NetronModule } from '@omnitron-dev/netron-nest';
import { AuthService } from './auth.service';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 4000,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379/0',
    }),
  ],
  providers: [AuthService],
})
export class AppModule {}
```

### Экспонирование сервисов с помощью декоратора

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@omnitron-dev/netron-nest';

@Injectable()
@Service('auth@1.0.0')
export class AuthService {
  login(user: string, pass: string) {
    return user === 'admin' && pass === 'admin';
  }
}
```

### Вызов удалённого сервиса

```typescript
import { Injectable } from '@nestjs/common';
import { InjectNetron, Netron } from '@omnitron-dev/netron-nest';

@Injectable()
export class RemoteService {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async authenticate(user: string, pass: string): Promise<boolean> {
    const authService = await this.netron.getService('auth@1.0.0');
    return authService.login(user, pass);
  }
}
```

---

## 🔍 Сравнение с микросервисами NestJS (gRPC)

| Характеристика                      | NestJS (gRPC)                       | Netron NestJS                      |
| ----------------------------------- | ----------------------------------- | ---------------------------------- |
| Транспорт                           | HTTP/2                              | WebSocket                          |
| Сервис-дискавери                    | Отсутствует (необходима настройка)  | Встроенное (Redis-based)           |
| Автоматическая регистрация сервисов | Нет                                 | Да                                 |
| Обнаружение недоступных узлов       | Только через балансировщики нагрузки| Автоматически (heartbeat, TTL)     |
| Graceful Shutdown                   | Ограниченная поддержка              | Полная поддержка                   |
| Производительность                  | Высокая                             | Высокая                            |
| Потоки и событийность               | Stream (ограниченный HTTP/2)        | Полноценные потоки через WebSocket |
| Простота настройки                  | Средняя (требует proto-файлов)      | Высокая (декларативные декораторы) |

### Когда использовать Netron вместо gRPC?

- 📌 **Если нужна автоматическая регистрация и обнаружение сервисов** без дополнительного middleware.
- 📌 **Если важна простота разработки и настройки** без протокольных файлов (`.proto`) и дополнительных инструментов.
- 📌 **Если требуется надёжная автоматическая обработка ошибок** и механизм heartbeat для гарантии доступности узлов.
- 📌 **Если важны полноценные стримы и событийная модель** поверх WebSocket.

---

## 🛠️ Работа с Redis (сервис-дискавери)

Netron использует Redis в качестве backend для сервис-дискавери. Это позволяет сервисам:

- Автоматически регистрировать себя при запуске.
- Поддерживать heartbeat (TTL-ключи) для автоматического определения доступности.
- Использовать Redis Pub/Sub для быстрого распространения информации о состоянии сервисов.

---

## ✅ Полноценное покрытие тестами

Тесты включают:

- Unit и интеграционные тесты для всех компонентов
- Тесты на ошибки и retry-логику Redis
- Lifecycle-тесты (запуск, graceful shutdown)

Запуск тестов с Jest:

```bash
npm run test
```

---

## 📌 Важные декораторы и токены

- `@Service(name@version)` – экспонирование сервисов
- `@InjectNetron()` – инжектирование инстанса Netron
- `NETRON_OPTIONS`, `NETRON_INSTANCE` – токены для DI

---

## 📚 Подробный пример микросервиса (NestJS + Netron)

### Сервер (микросервис):

```typescript
import { Module } from '@nestjs/common';
import { NetronModule } from '@omnitron-dev/netron-nest';

@Module({
  imports: [
    NetronModule.forRoot({
      listenHost: 'localhost',
      listenPort: 5000,
      discoveryEnabled: true,
      discoveryRedisUrl: 'redis://localhost:6379/1',
    }),
  ],
})
export class UserServiceModule {}
```

### Реализация сервиса:

```typescript
import { Injectable } from '@nestjs/common';
import { Service } from '@omnitron-dev/netron-nest';

@Injectable()
@Service('user.service@1.0.0')
export class UserService {
  getUser(id: string) {
    return { id, name: 'John Doe' };
  }
}
```

### Клиент (другой микросервис):

```typescript
import { Injectable } from '@nestjs/common';
import { InjectNetron, Netron } from '@omnitron-dev/netron-nest';

@Injectable()
export class ClientService {
  constructor(@InjectNetron() private readonly netron: Netron) {}

  async fetchUser(id: string) {
    const userService = await this.netron.getService('user.service@1.0.0');
    return userService.getUser(id);
  }
}
```

---

## ⚖️ Лицензия

MIT © LuxQuant