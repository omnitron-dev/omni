# rotif — Redis-based notification system

**rotif** is a TypeScript library for organizing a notification system using Redis as a backend. It is designed for sending and receiving messages (notifications) between components of a distributed system with high reliability and flexibility. The library supports two message delivery modes – **Redis Streams** for reliable delivery with acknowledgment (ack) and **Redis Pub/Sub** for simple real-time broadcast notifications. Additionally, rotif provides capabilities for delayed message delivery, automatic retry attempts in case of failures, maintaining a dead letter queue (DLQ), message deduplication for *exactly-once* semantics, as well as a set of middleware hooks for extending functionality. The library is designed for horizontal scaling and stable operation in production, including support for Redis Cluster.

## General description and capabilities

**rotif** solves the task of exchanging events and notifications between services or modules, using Redis as a high-performance message broker. Key capabilities of the library:

- **Publish and subscribe** to events via Redis Streams (with *consumer group* mechanism for scalable concurrent processing) or via Redis Pub/Sub (for cases where message loss is acceptable).
- **Delayed message delivery** – ability to set a delay or exact delivery time for a message.
- **Automatic retries** for failed processing – messages that failed to process can be automatically redirected for reprocessing at specified intervals.
- **Dead Letter Queue (DLQ)** – a special "dead letter queue" for messages that could not be processed after all attempts; allows not to lose such messages but process them separately.
- **Deduplication and *exactly-once* semantics** – prevention of duplicate message processing, both at the single process level and globally (using Redis to store processed IDs).
- **Middleware hooks** – extension points allowing to execute additional code before and after message publication or processing, as well as intercept errors.
- **Subscription statistics** – ability to get statistical data for each subscription (number of processed messages, number of errors, etc.) via the `Subscription.stats()` method.

Thanks to these capabilities, rotif is suitable for building reliable event exchange systems: from simple real-time notifications to task queue elements with delivery guarantees and retry execution. Below is detailed documentation on installation, configuration, and usage of the library.

## Installation and Requirements

Before getting started, ensure the following requirements are met:

- **Node.js**: version 14 or higher (the library is written in TypeScript and transpiles to modern JavaScript compatible with ES2020+).
- **TypeScript**: (optional) version 4.x or higher for development with typing. The library comes with included `.d.ts` type definitions.
- **Redis**: version 5.0 or higher. Redis Streams mode requires Redis ≥ 5.0 (Streams were introduced in Redis 5). Redis 6.x or 7.x is recommended for full support of all commands (for example, `XAUTOCLAIM` command is available starting from 6.2). The library is also compatible with Redis 7+ and supports operation in Redis Cluster mode.
- **Redis Connection**: deploy a Redis server instance (locally or in the network) and ensure you can connect to it. If you plan to use Redis Streams in production, configure persistence mechanism (RDB snapshots or AOF) for reliable data storage.

Install the library via npm:

```bash
npm install rotif
```

Or using Yarn:

```bash
yarn add rotif
```

After installation, you can import `NotificationManager` in your project:

```typescript
import { NotificationManager } from 'rotif';
```

The library does not require additional dependencies except for the Redis client. By default, it uses the official **node-redis** client (v4+) to connect to Redis via the provided URL. Optionally, rotif can use `ioredis` when working with Redis Cluster (see the cluster section). In the minimal configuration, it's sufficient to specify the Redis connection URL.

## NotificationManager Configuration

The main class of the library is **NotificationManager**. An instance of this class manages the Redis connection, message publishing, and background processes for handling subscriptions, delayed messages, etc. When creating a `NotificationManager`, you can specify a number of settings in the form of a constructor options object:

```typescript
const manager = new NotificationManager({
  redis: {
    host: parsed.hostname,
    port: parseInt(parsed.port || '6379'),
    db: 0, // optional
  },
  // ... other options ...
});
```

Below are the main configuration parameters of `NotificationManager` and their purpose:

- **`redisUrl`** (`string`) – Redis connection URL. URI format is supported, including host, port, database, and password specification (e.g., `redis://:password@host:6379/0`). This is the main parameter for establishing a connection. If Redis is running in Cluster mode, specify the URL of one of the cluster nodes (the library will automatically redirect requests by slots) or use `redisUrls`/`nodes` (see below).
- **`redisOptions`** (`object`, optional) – alternatively to URL, you can pass a Redis client options object (e.g., configuration object for `createClient` from `node-redis`). This can be useful for specifying connection details (timeouts, TLS, etc.) or for passing a pre-created client:
  ```typescript
  const client = createClient({ url: 'redis://localhost:6379' });
  const manager = new NotificationManager({ client });
  ```
  If `client` is passed, the `redisUrl` parameter is ignored.
- **`useCluster`** (`boolean`, default `false`) – flag indicating Redis Cluster mode usage. If `true`, the library expects a list of nodes in `redisOptions` or a valid cluster URL. In cluster mode, rotif will try to work correctly with streams and pub/sub (see cluster section).
- **`groupName`** (`string`, optional) – global default consumer group name for all Streams subscriptions. If specified, this group name will be used when subscribing to a stream through Streams (if the group doesn't exist, it will be created). Otherwise, the group needs to be specified separately for each subscription (explicit specification is recommended for transparency). Using a single group means that all instances of your application will be competing consumers within this group.
- **`consumerName`** (`string`, optional) – default consumer name for the current application instance. Applied when subscribing to Streams. Must be unique for each process/instance, otherwise two instances with the same name will be treated by Redis as one consumer (which can lead to incorrect message distribution). If not specified, the library will automatically generate a unique name (e.g., based on process ID or random UUID).
- **`retryAttempts`** (`number` or `number[]`, default `0`) – retry configuration. Can be a number (number of retry attempts after the first, e.g., `retryAttempts: 3` means total 4 attempts: 1 main + 3 retries) or an array of numbers specifying intervals (in milliseconds) before each attempt. For example, `retryAttempts: [1000, 5000, 10000]` – first retry after 1 second, second after 5 sec, third after 10 sec. If a number is specified, a fixed delay between retries is used by default (see `retryDelay`). If `0` – retries are disabled (message will go to DLQ immediately on error or just be considered failed).
- **`retryDelay`** (`number`, default `5000`) – delay (in ms) before retrying message processing if `retryAttempts` is set as a number. Ignored if `retryAttempts` is specified as an array (in this case, delays are taken from the array).
- **`enableDLQ`** (`boolean`, default `true`) – enables Dead Letter Queue mechanism. If `true`, after exhausting all retry attempts, the message will be sent to a special DLQ stream. If `false`, messages after failures are just marked as processed (or deleted) without saving. Generally, it's not recommended to disable DLQ as it's the last chance to investigate lost messages.
- **`dlqStreamName`** (`function | string`, default adds suffix `":DLQ"` to event name) – defines the stream (or channel) name for DLQ. By default, each event will have its own DLQ stream. For example, for event `"orderCreated"` the DLQ stream will be named `"orderCreated:DLQ"`. You can pass your own name generation function or string template. For cluster environments, make sure the DLQ key falls into the same hash slot as the original stream (e.g., using `{}` in the name).
- **`dedupStore`** (`"memory" | "redis" | false`, default `false`) – enables message deduplication (*exactly-once* semantics). If value is `"memory"`, the library will store processed message IDs in process memory (within a single instance) and filter out duplicates. If `"redis"`, Redis is used for storing IDs (e.g., as a set or Bloom filter), allowing to track duplicates between different instances and guarantee exactly-once semantics globally. If `false` – deduplication is disabled (repeated processing is possible on redelivery). See deduplication section for details.
- **`dedupTTL`** (`number`, default `86400` seconds = 24 hours) – TTL for deduplication records. After this period, the processed message ID will be removed from the deduplication store, after which redelivery of the same ID will be processed as a new message. This option prevents unlimited growth of memory for storing all ever-processed messages. Configure TTL depending on your required exactly-once window. Ignored if `dedupStore` = false.
- **`delayProcessingInterval`** (`number`, default `1000` ms) – period (interval) for checking delayed messages. The library uses an internal timer that checks the delayed message store at this interval and publishes those whose delivery time has come. The default value of 1 second means that a message will be delivered within ~1 second after its `deliverAt` time. You can decrease the interval for greater accuracy (with load on Redis) or increase it to save resources.
- **`maxStreamLength`** (`number | "approx"`, optional) – maximum stream length when adding new messages. If a number is specified, the library will call `XADD ... MAXLEN` to trim the stream to approximately this number of records (approximate trimming with `~`). If `"approx"` is specified along with a number, approximate trimming is used; if just a number, exact trimming. For example, `maxStreamLength: 10000` will maintain each stream length around 10k messages, removing old records. Be careful: stream trimming is suitable if you have *one* consumer group or all groups have already processed old messages. Otherwise, don't trim messages that haven't been read by the needed groups yet.
- **Middleware hook parameters** – hooks can be passed both in manager configuration and added/overridden during subscription. Global hooks:
  - `beforePublish(event, message)` – called before publishing a message to Redis. Can be used for logging or message modification. If returns `false`, publication will be cancelled.
  - `afterPublish(event, message, messageId)` – called after successful message sending (returns `messageId` for Streams or `number` of recipients for Pub/Sub). Used for logging, metrics, etc.
  - `beforeProcess(event, message)` – global hook before message processing by subscriber. Called **before** user handler. Can, for example, trace processing start.
  - `afterProcess(event, message)` – global hook after successful message processing (after handler execution and ack). Can be used to collect metrics on processing time.
  - `onError(event, message, error)` – global error handler for errors occurring during message processing. Called before retry/DLQ logic. Can log error or metric. If `onError` returns `false`, the library will **not** perform standard retry/DLQ mechanism for this message (considered manually handled).

These same hooks can also be specified at the level of specific subscription (see below) to apply them only to a certain event. Local hooks (override global ones) are passed through options when calling `subscribe()`.

This is far from a complete list of settings - **NotificationManager** can also accept other Redis client options (such as TLS options, read blocking time, etc.) through `redisOptions`. The ones listed above are the main ones used to control the library's behavior. Below we will look at the practical application of these settings.

## Usage: Publishing and Subscribing

rotif allows you to create *publishers* and *subscribers* of notifications with minimal code. The main methods are `publish()` for sending messages and `subscribe()` for listening to messages. Both methods work with both the Streams mechanism and Pub/Sub.

### Publishing Messages

The `publish(event, payload, options?)` method sends a new message (notification) about an event. Parameters:
- `event` (`string`): event/channel name. For example, `"user.registered"` or `"orderCreated"`. This name will be used as the Redis key: either as a Redis Stream name or as a Pub/Sub channel name.
- `payload` (`any`): message data. Any serializable object. The library automatically serializes the message (default to JSON) before sending and deserializes it on the receiver's side. The data can include, for example, user ID, order details, etc.
- `options` (`object`, optional): additional options for the specific message:
  - `deliverAt` (`Date` or `number`) – delayed delivery: absolute time when the message should be delivered to subscribers. You can pass a Date object or timestamp (UTC ms). If `deliverAt` is set in the future, the message will be stored in a special delayed list in Redis and will only be sent when the current time exceeds the specified time.
  - `delayMs` (`number`) – delayed delivery: relative delay in milliseconds. For example, `delayMs: 5000` will send the message after 5 seconds. `delayMs` is syntactic sugar for `deliverAt = Date.now() + delayMs`.
  - `dedupKey` (`string`) – message deduplication key. If specified and deduplication is enabled (`dedupStore`), the library will mark this message with this key. Repeated publications with the same `dedupKey` may be discarded (exact behavior depends on the deduplication mode, see the dedup section). For example, you can use a unique event ID to prevent duplicate processing.
  - `pubsub` (`boolean`) – force sending via Pub/Sub (ignoring Streams). By default, if there are subscribers via Streams (with groups) for this event, the message will be added to the stream (Stream). If all subscriptions for the event use Pub/Sub or this flag is explicitly set, the `PUBLISH` mechanism will be used. Usually you don't need to specify this – rotif automatically determines the optimal delivery method.
  - `headers` (`object`) – auxiliary message metadata (e.g., context, type, etc.). These will be stored with the message. In Streams, these metadata are stored as additional record fields, in Pub/Sub they may be included in the payload. Processing of `headers` remains on your application's side (for example, you can pass a trace-id for distributed tracing).

Example - let's send a simple user registration notification:

```typescript
await manager.publish('user.registered', { userId: 123, name: 'Alice' });
```

This call will immediately write the message to Redis. If there are subscribers to the `"user.registered"` event:
- Through **Streams** (when a consumer group exists) - the message will be added to a Stream named `"user.registered"` and become available for reading by subscribers in the group.
- Through **Pub/Sub** - the message will be sent through the `"user.registered"` channel to all current subscribers.

If there are no subscribers, the behavior differs:
- In the case of **Streams**, the message will remain in the stream until it is read (or deleted/trimmed by an administrator). This allows subscribers to connect later and receive even previously sent messages (if their group is configured to read from the beginning or the stream hasn't been trimmed).
- In the case of **Pub/Sub**, the message simply won't be received by anyone (if there were no active subscribers at the time of publication). Such messages are not stored - this is a characteristic of Redis Pub/Sub.

**Choosing between Streams vs Pub/Sub:**  
By default, rotif prefers **Streams** as they provide reliable delivery (albeit with slightly higher latency) and guarantees. When you call `subscribe()` specifying a `group` (group name) - you create a Stream subscriber. If you call `subscribe()` without a group (or explicitly with the `{ pubsub: true }` option), you use Pub/Sub. Typically, Streams are chosen for critical events (financial transactions, system state changes), while Pub/Sub is used for non-critical or secondary events. You can use both approaches simultaneously for different events within the same `NotificationManager`.

### Subscribing to Messages

To receive notifications, use the `subscribe(event, handler, options?)` method. After calling it, the library starts listening to the specified event/channel in the background and calls the handler function when new messages arrive. Parameters:
- `event` (`string`): event name (must match the name used when publishing).
- `handler` (`function`): message handler function, called as `handler(message, context)`. Here `message` is the parsed content passed during publishing (`payload`), and `context` is additional message information:
  - `context.id` – message identifier (Redis Stream ID string, or `null` for Pub/Sub where messages don't have IDs).
  - `context.attempt` – processing attempt number (retry counter; `1` for first attempt, increases on retries).
  - `context.timestamp` – timestamp when the message was published.
  - `context.event` – event name.
  - `context.deduplicated` – flag indicating if the message was marked as a duplicate and skipped (see deduplication). Usually `false` for normal processing, `true` if the message was processed before.
  - ... and others (including `headers` if they were set during publishing).
- `options` (`object`): subscription settings:
  - `group` (`string`) – **required for Streams**: consumer group name. If specified, the subscription will work through Redis Streams with this group. The group will be automatically created if it doesn't exist (with initial position `$`, i.e., receiving only new messages). All subscribers using the same group name for this `event` form a *consumer group* and will process the message stream jointly (concurrently), each receiving their portion. If no group is specified and `pubsub` is not enabled, the library may use an implicit default group (see `groupName` in config) or switch to Pub/Sub mode.
  - `consumer` (`string`) – name of a specific consumer in the group (for Streams). If not specified, the global `consumerName` from settings will be used or generated automatically. In **each process** of the application, the consumer name for one group must be unique, otherwise Redis won't distinguish them. For example, you can use hostname or instance ID. The consumer is responsible for tracking read/unacknowledged messages within the group.
  - `pubsub` (`boolean`) – if `true`, explicitly sets Pub/Sub mode for this subscription, ignoring groups. Used when you want to subscribe to a Pub/Sub channel regardless of group settings. If `pubsub: true` is specified, the `group` and `consumer` parameters are ignored.
  - `manualAck` (`boolean`, default `false`) – manual acknowledgment mode. By default for Streams, the library automatically sends acknowledgment (`XACK`) after successful execution of your `handler`. If manualAck is enabled, the library won't automatically acknowledge, and you have access to the `context.ack()` function inside the handler for explicit acknowledgment. This mode is useful if you want to acknowledge messages after performing some asynchronous actions outside the main handler.
  - Local hooks: `beforeProcess`, `afterProcess`, `onError` – you can pass functions similar to global hooks, but they will be applied **only** for this subscription (overriding global ones). Their signatures are the same but without the `event` parameter (since it's known):
    - `beforeProcess(message, context)`
    - `afterProcess(message, context)`
    - `onError(message, context, error)`
    - For example, you can pass `onError` for a specific subscription to handle errors for this type of message in a special way.

**Пример 1: подписка на события через Streams (надёжная доставка)**

```typescript
// Подписываемся на событие "order.created" с использованием группы "orderService"
manager.subscribe('order.created', async (order, ctx) => {
  console.log('Получен новый заказ:', order.id);
  try {
    // Обработка заказа...
    await processOrder(order);
    console.log('Заказ обработан успешно');
    // После возврата промиса или резолва, rotif автоматически выполнит XACK
  } catch (err) {
    console.error('Ошибка при обработке заказа:', err);
    throw err; // проброс ошибки сигнализирует rotif, что обработка не удалась
  }
}, { group: 'orderService', consumer: 'orderService-instance-1' });
```

В этом примере все экземпляры вашего приложения, подписанные на `"order.created"` с одной группой `"orderService"`, будут совместно получать заказы из одного потока:
- Сообщения распределяются между потребителями (конкурентно) внутри группы. Например, первый заказ может достаться экземпляру с consumer `"instance-1"`, второй – `"instance-2"`, и т.д.
- Если обработчик завершается без выброса ошибки (или возвращает успешно резолвленный промис), rotif отправляет подтверждение Redis (`XACK`), и сообщение считается обработанным.
- Если происходит ошибка (исключение/отклонение промиса), rotif **не подтверждает** сообщение и инициирует механизм **retry** (описан далее). Таким образом, сообщение останется в *Pending Entries List* группы и через заданное время будет повторно выдано (либо этому же consumer-у, либо другому, см. retry и zombie-consumers ниже).

**Пример 2: подписка через Pub/Sub (широковещательно, без подтверждений)**

```typescript
// Подписываемся на уведомления о входе пользователя через Pub/Sub
manager.subscribe('user.login', (info, ctx) => {
  console.log(`Пользователь ${info.userId} вошел в систему с IP ${info.ip}`);
  // Здесь даже если бросить ошибку, повторной доставки не будет (Pub/Sub at-most-once)
}, { pubsub: true });
```

В этом случае подписка осуществляется через Redis Pub/Sub:
- Все экземпляры, подписавшиеся на `"user.login"` с `pubsub: true`, будут получать *каждое* сообщение (в отличие от Streams, где сообщение в рамках группы идёт только одному потребителю). Это полезно для событий, которые каждый получатель должен обработать независимо (например, обновление кэша в разных сервисах, оповещение нескольких несвязанных систем и т.п.).
- Нет механизма подтверждения или повторной доставки: если обработчик упал или не успел, сообщение всё равно считается доставленным (semantics *at-most-once*). 
- Pub/Sub быстрее и потребляет меньше ресурсов Redis (нет хранения сообщений), но не гарантирует доставку если получатель был оффлайн или произошёл сбой во время обработки.

Вы можете вызывать `subscribe()` несколько раз для разных событий или даже для одного и того же события в разных местах программы. Метод `subscribe` возвращает объект **Subscription**, который представляет подписку и позволяет получить статистику, а также отписаться при необходимости. Например:

```typescript
const subscription = manager.subscribe('metrics.update', onMetrics, { group: 'metricsService' });
// ... позднее, если нужно остановить получение:
subscription.unsubscribe(); // закроет соединение/слушатель для этого события
```

> **Важно:** Если вы вызываете `subscribe()` без указания `group` **и** без `{ pubsub: true }`, библиотека решит способ подписки автоматически. Обычно, если для этого события уже создавалась группа (или задан `groupName`), подписка пойдёт через Streams (создав новую группу или используя существующую). Если же ни одной группы для события нет, будет использован Pub/Sub. Рекомендуется явно указывать `group` для критичных путей или `pubsub` для широковещательных, чтобы избежать двусмысленности. Не смешивайте в рамках одного события подписчиков Streams и Pub/Sub – хотя rotif поддерживает оба, логика доставки в этих режимах не синхронизирована между собой (т.е. `publish` не будет отправлять одно сообщение и в поток, и в канал автоматически).

## Отложенные сообщения (Scheduled Delivery)

Библиотека позволяет планировать доставку сообщения с задержкой или к определенному моменту времени. Это удобно для реализации отложенных уведомлений, напоминаний, или ретри с задержкой.

Чтобы отправить сообщение с задержкой, используйте опции `delayMs` или `deliverAt` при публикации:

```typescript
// Отправить уведомление "password.reset" через 1 час
await manager.publish('password.reset', { userId: 42, email: 'user@example.com' }, 
  { delayMs: 3600_000 });
// То же самое, указав конкретное время доставки (например, завтра 9:00)
const deliverTime = new Date();
deliverTime.setDate(deliverTime.getDate() + 1);
deliverTime.setHours(9, 0, 0, 0);
await manager.publish('password.reset', { userId: 42, email: 'user@example.com' }, 
  { deliverAt: deliverTime });
```

При использовании этих опций rotif **не сразу** доставляет сообщение подписчикам. Вместо этого оно сохраняется во временном хранилище (в Redis) до наступления заданного времени:
- Реализация: библиотека использует отсортированное множество (Redis Sorted Set) для хранения отложенных сообщений, где значение – содержание сообщения, а *score* – метка времени доставки. Внутренний таймер (`delayProcessingInterval`) периодически проверяет Redis на наличие сообщений со временем `<= сейчас` и переносит их в основной поток/канал.
- Когда наступает время доставки, сообщение автоматически публикуется как обычное (будто вызвали `publish` без задержки). Подписчики получат его в штатном порядке.

Преимущества такого подхода:
- Надежность: отложенные сообщения хранятся в Redis, и не пропадут при перезапуске приложения. Даже если приложение/NotificationManager перезапущены, новые экземпляры продолжат обработку отложенных сообщений (важно: при мульти-инстансовом развертывании убедитесь, что запущен только один таймер обработки задержек, либо используйте механизм *leader election* — в текущей версии rotif предполагается один активный instance для отложенных задач, чтобы не дублировать публикацию).
- Точность: можно довольно точно указать время. Задержка ограничена только точностью системных часов и интервалом опроса (по умолчанию шаг 1 сек).
- Гибкость: deliverAt позволяет указать конкретное время (например, *cron*-подобные сценарии: “отправить уведомление в полночь”), delayMs – проще для относительных задержек (“через N секунд”).

**Важно:** Отложенные сообщения на данный момент поддерживаются **только в режиме Streams.** Если вы публикуете с задержкой, даже для событий, на которые подписаны Pub/Sub получатели, библиотека воспользуется механизмом Streams, чтобы гарантировать хранение. Таким образом, подписчикам через Pub/Sub такие сообщения придут **только если** на то же событие есть хотя бы один подписчик Streams-группы (который получит сообщение из стрима и далее, возможно, вручную републикует в канал – подобного функционала сейчас нет). Проще: используйте delay только если подписчики работают через Streams. Если вам нужна отложенная широковещательная доставка – рассмотрите изменение архитектуры или используйте отдельный поток + подписчик, который потом выполнит PUBLISH.

rotif автоматически создаёт необходимое хранилище и обрабатывает его. Однако обратите внимание на нагрузку:
- Все отложенные сообщения хранятся в одном sorted set (`rotif:scheduled` по умолчанию, либо с префиксом, если указан). Количество элементов в нём равно количеству отложенных сообщений, не доставленных на текущий момент. Желательно чистить/ограничивать его, если планируются миллионы отложенных событий.
- Интервал опроса (`delayProcessingInterval`) можно настроить. Слишком частый опрос (например, 50-100 мс) увеличит нагрузку на Redis, слишком редкий (несколько секунд) – снизит точность времени доставки. 1 секунда – баланс между точностью и нагрузкой.
- В кластере Redis хранение отложенных событий можно поместить в отдельный узел (ключ `rotif:scheduled`), т.к. команда выборки (ZPOPMIN) не конфликтует с операциями над стримами.

## Повторные попытки (Retry)

Одно из ключевых преимуществ использования rotif (и Redis Streams) – встроенная поддержка повторных попыток обработки сообщений. В реальных системах обработка сообщения может завершиться неудачно: например, из-за временной ошибки сети или недоступности внешнего сервиса. Вместо того чтобы сразу признавать такое сообщение потерянным, rotif позволяет автоматически повторить попытку спустя некоторое время.

**Как это работает:**  
Когда подписчик обрабатывает сообщение в режиме Streams и выбрасывает ошибку (или возвращает отклонённый Promise), библиотека фиксирует неудачу:
- Сообщение **не подтверждается** (`XACK` не вызывается). Вследствие этого в Redis оно остаётся в списке *pending* для группы – т.е. помечено как доставленное consumer-у, но не обработанное.
- NotificationManager планирует повторную доставку. Интервал и количество повторов задаётся настройками `retryAttempts` и `retryDelay` в конфигурации.
- Через указанный промежуток rotif либо с помощью команды `XCLAIM`/`XAUTOCLAIM` забирает сообщение из pending обратно и передаёт на обработку снова, либо (проще) публикует новое сообщение с теми же данными. **В реализации rotif используется подход повторной выдачи pending сообщений**, что обеспечивает сохранение исходного идентификатора и истории попыток.
- Поле `context.attempt` в обработчике позволяет узнать номер текущей попытки. Первый вызов обработчика для сообщения – attempt = 1, при первом retry – 2 и т.д.
- Если сообщение успешно обработано на одной из повторных попыток, процесс останавливается: вызывается XACK и сообщение удаляется из pending.
- Если сообщение продолжает ошибаться и количество попыток достигло `retryAttempts` (например, 3 повтора), то дальнейшие попытки прекращаются. Такое сообщение считается безнадёжным и перемещается в **DLQ** (Dead Letter Queue), если она включена.

Настройки, влияющие на поведение:
- `retryAttempts`: сколько раз пробовать снова. Если это число 0, retry отключен (любая ошибка ведёт сразу к DLQ или потере). Если 1 – будет одна повторная попытка (итого 2 обработки максимум).
- `retryDelay`: фиксированная задержка перед **каждым** повтором, если `retryAttempts` число. Если массив – задержки между попытками могут различаться.
- Максимальное время ожидания перед повтором – суммарно определяется настройками. Например, `retryAttempts: [1000, 5000, 10000]` охватывает три повтора в течение ~16 секунд. Если приложение или Redis находятся в оффлайне в момент, когда должен был произойти retry, попытка выполнится как только сервис восстановится (т.е. задержка фактически может быть дольше запланированной, но не короче).

**Пример: обработка с автоматическим ретраем**

Допустим, у нас есть сервис, который отправляет электронные письма, и мы хотим, чтобы неудачная попытка отправки повторялась 2 раза с интервалом в 10 секунд:

```typescript
const manager = new NotificationManager({ retryAttempts: 2, retryDelay: 10000 });
manager.subscribe('email.send', async (payload) => {
  const { address, body } = payload;
  console.log(`Отправка письма на ${address}...`);
  await emailService.sendMail(address, body);
  console.log('Письмо отправлено успешно.');
}, { group: 'mailer' });
```

```typescript
// Публикуем задачу на отправку письма
await manager.publish('email.send', { address: 'user@example.com', body: 'Hello!' });
```

В этом примере, если `emailService.sendMail` выбросит ошибку (например, соединение SMTP не удалось):
- Первая попытка (attempt=1) неудачна, сообщение остаётся не подтвердённым.
- Через 10 секунд rotif автоматически выдаст сообщение снова тому же или другому свободному consumer-у группы "mailer". В логе будет вторая попытка.
- Если со второй попытки также получаем ошибку, через ещё 10 секунд будет третья, последняя попытка (retryAttempts = 2 означает 2 повтора + 1 оригинал = 3 попытки).
- В случае успеха на любой из попыток – мы выйдем из цикла ретраев.
- В случае неудачи на всех попытках – сообщение переместится в DLQ (подробнее далее).

**Замечания по реализации:**
- rotif отслеживает время, прошедшее с момента выдачи сообщения, через поле *Idle* (простой) в Redis Streams. Команда `XREADGROUP` может использоваться с параметром `BLOCK` (блокирующее чтение). В то же время, чтобы реализовать задержку перед повтором, библиотека использует `XAUTOCLAIM` (начиная с Redis 6.2) или `XCLAIM` для получения сообщений, находящихся в pending дольше заданного интервала. Проще говоря, сообщение, которое висит не подтверждённым дольше `retryDelay`, считается "просроченным" и передаётся заново.
- Каждая повторная доставка происходит с тем же `message.id` (если Streams) и с increment-ом поля `attempt` в контексте. То есть, вы можете логировать попытки и видеть, что, например, message ID `1656367412345-0` обработан с attempt=3.
- **Ограничение:** Retry работает только для механизма Streams. В режиме Pub/Sub, поскольку нет понятия pending и ack, библиотека **не может** повторно отправить сообщение автоматически. Если вам нужны повторы – используйте Streams. (Вы конечно можете в обработчике Pub/Sub самостоятельно вызвать повторную логику, но это вручную).

## Dead Letter Queue (DLQ)

**Dead Letter Queue** – это механизм отвода "необрабатываемых" сообщений. Если сообщение исчерпало все попытки обработки и так и не было успешно обработано, его можно направить в специальную очередь (или поток) для дальнейшего анализа, ручной обработки или повторной загрузки позже.

В rotif DLQ включён по умолчанию (`enableDLQ: true`). Как он работает:
- После последней неудачной попытки (например, 3-й retry, если вы задали 2 повтора), сообщение не подтверждается и больше не будет автоматически раздаваться подписчикам.
- Вместо этого NotificationManager выполняет публикацию этого сообщения в отдельный **DLQ-поток**. По умолчанию его имя – оригинальное имя события + суффикс `:DLQ`. Например, для события `"email.send"` DLQ-поток будет `"email.send:DLQ"`.
- Сообщение в DLQ обычно содержит те же данные, что и оригинальное, плюс некоторые метаданные о неудачной обработке (например, число попыток, причина ошибки). Формат может выглядеть так:
  ```json
  {
    "originalPayload": { ... }, 
    "error": "Description of last error",
    "attempts": 3,
    "timestamp": 1680000000000
  }
  ```
  (Конкретный формат зависит от реализации, но в целом полезно сохранить информацию о причине сбоя).
- DLQ-поток – это обычный Redis Stream. Вы можете подписаться на него так же, как на другие события, с помощью `subscribe`. Например:
  ```typescript
  manager.subscribe('email.send:DLQ', (msg) => {
    console.error('Сообщение попало в DLQ:', msg.error, msg.originalPayload);
    // Можно реализовать оповещение разработчиков, запись в особый лог, либо попытку особой обработки
  }, { group: 'dlqHandlers' });
  ```
  Таким образом, у вас может быть отдельный обработчик для "проваленных" сообщений.

**Важно:** обработка DLQ-сообщений – на ваше усмотрение. Библиотека лишь помещает их в поток. Вы можете:
- Просматривать их через `XREAD`/`XREADGROUP` инструментами redis-cli для ручного анализа.
- Автоматически мониторить и оповещать (например, отправлять алерт, если что-то оказалось в DLQ).
- Попытаться спустя время перезапустить обработку: например, переносить из DLQ обратно в основной поток или вызывать нужные действия вручную. (rotif не реализует автоматического *реигра* DLQ, т.к. это специфично для каждого случая).
- Очищать DLQ спустя какое-то время, если сообщения не критичны, чтобы не копить бесконечно (возможно, с помощью `XTRIM` или вручную).

Если вы не хотите пользоваться DLQ, можно отключить `enableDLQ`. В этом случае после последней неудачной попытки rotif просто выполнит `XACK` (чтобы убрать сообщение из pending) и *не* будет сохранять его. Вы потеряете это сообщение, о чём следует помнить.

Заметим, что DLQ применим только к режиму Streams (по тем же причинам, что и retry). В Pub/Sub нет ретраев, а значит и DLQ не формируется – сообщение просто будет упущено. Поэтому, если для вас важна гарантия не потерять ни одно сообщение, используйте Streams + DLQ.

## Exactly-once и дедупликация сообщений

По умолчанию, система на базе Redis Streams обеспечивает семантику **at-least-once**: каждое сообщение будет доставлено *как минимум одному* потребителю. Однако возможно, что при сбоях или повторах некоторые сообщения будут доставлены повторно тому же или другому потребителю (например, после рестарта приложения или при ручном переносе pending-сообщений). Чтобы избежать повторной обработки одних и тех же событий, rotif может применить **дедупликацию**.

Дедупликация – это фильтрация повторных сообщений по уникальному идентификатору, чтобы обработчик не выполнил работу дважды. В контексте rotif дедупликация позволяет достичь эффекта *exactly-once processing* – т.е. каждый логический "идемпотентный" идентификатор события будет обработан ровно один раз.

Механизмы дедупликации в rotif:
- **In-memory (в памяти)**: Когда включен режим `dedupStore: "memory"`, NotificationManager будет хранить в памяти (например, в `Set`) идентификаторы уже обработанных сообщений. Идентификатором может служить либо Redis Stream ID (который уникален для каждой записи в стриме), либо пользовательский `dedupKey`, указанный при публикации. При получении нового сообщения подписчик сначала проверяет: не содержится ли его ID/ключ в уже обработанных. Если содержится, сообщение пропускается (считается дубликатом) – обычно это выражается в том, что обработчик вообще не вызывается, а сообщение сразу `XACK`-ается как обработанное. Если идентификатора нет в памяти, он туда добавляется и сообщение обрабатывается нормально.
  - Преимущество: очень быстрый доступ (память), простота.
  - Недостаток: каждая нода хранит только то, что сама обработала. В распределённой системе, где несколько процессов rotif параллельно, дубликат может попасть на другой процесс и там не будет отмечен. Также при перезапуске приложения память очищается, и защита от повторов для ранее обработанных сообщений теряется.
- **Redis-based (глобальная)**: При `dedupStore: "redis"` библиотека будет сохранять идентификаторы обработанных сообщений в Redis (например, в ключ-множестве `rotif:dedup:<event>`). Это даёт глянцевое хранилище, разделяемое всеми инстансами:
  - Когда сообщение обрабатывается успешно впервые, его ID добавляется в множество в Redis.
  - При получении нового сообщения каждый подписчик проверяет в Redis, есть ли такой ID. Если есть – сообщение считается уже обработанным ранее (возможно, другим инстансом) и пропускается (ack без вызова handler).
  - Если нет – ID добавляется и выполняется обработка.
  - Такая схема позволяет достичь *глобальной* дедупликации: даже если сообщение по каким-то причинам было доставлено дважды (например, publisher дважды добавил аналогичное сообщение или произошёл failover), все инстансы проверяют единое хранилище и вторую попытку отсеют.
  - Минусы: добавляется дополнительная нагрузка на Redis (одна операция чтения и одна записи в Redis на каждое сообщение). Также нужно ограничивать рост этого хранилища, поэтому и вводится TTL: по истечении TTL запись об обработке стирается и то же сообщение теоретически снова будет обработано, если вдруг придёт (впрочем, обычно к тому времени дубликаты уже не появятся).
  - Есть тонкость: Redis Stream ID сам по себе уникален (повторно такого не будет), но дедупликация помогает в сценариях ретраев и многократной доставки. Если использовать пользовательский `dedupKey`, то вы сами решаете, что считать дубликатом. Например, key = userId, тогда два события с одним userId будут считаться повтором (актуально, если по ошибке дублируется отправка).

Чтобы использовать дедупликацию, включите её в конфигурации. Например:

```typescript
const manager = new NotificationManager({ dedupStore: 'redis', dedupTTL: 3600 });
```

А при публикации указывайте `dedupKey` для сообщений, если требуется логическая дедупликация. Если `dedupKey` не указан, для Streams по умолчанию используется Stream ID в качестве ключа (достаточно для защиты от повторной обработки при XCLAIM/ретраях). Для Pub/Sub без указанного ключа дедупликация не имеет смысла, т.к. нет ID – библиотека просто не будет ничего делать.

**Пример: дедупликация сообщений**

```typescript
// Включим дедупликацию в памяти для примера
const manager = new NotificationManager({ dedupStore: 'memory' });

// Подписчик на событие
manager.subscribe('inventory.update', (item) => {
  console.log('Обновление остатка товара', item.sku);
  updateInventory(item.sku, item.delta);
}, { group: 'inventoryService' });

// Имитация дубликатов: публикуем два раза одно и то же
await manager.publish('inventory.update', { sku: 'A123', delta: 5 }, { dedupKey: 'A123-5' });
await manager.publish('inventory.update', { sku: 'A123', delta: 5 }, { dedupKey: 'A123-5' });
```

В этом примере второй вызов `publish` имеет тот же `dedupKey`. Библиотека определит, что такое сообщение уже было обработано:
- В режиме `memory` – тот же процесс уже внёс `A123-5` в Set после первого выполнения, и при второй доставке (которая, скорее всего, придёт тому же процессу) определит дубликат и не вызовет обработчик.
- Если бы был режим `redis` – даже если второй publish исполнился на другом сервисе, при доставке подписчик через Redis set обнаружил бы ключ и тоже проигнорировал.
- Таким образом, `updateInventory` вызовется ровно один раз, несмотря на двойную публикацию.

Замечание: **дедупликация в Pub/Sub.** В каналах Pub/Sub нет естественных идентификаторов, поэтому dedup работает только при указании `dedupKey` (и только если вы настроили `dedupStore: 'redis'`, так как `'memory'` в рамках одного процесса бессмысленна для pub/sub, где все дубликаты придут сразу и, скорее всего, обработаются до того, как ключ успеет установиться). Однако, в целом, если вам нужна exactly-once, лучше использовать Streams.

## Хуки (middleware) для расширения функционала

rotif позволяет подключать *middleware*-функции (хуки) на разных этапах обработки сообщений. Это полезно для кросс-секционных задач: логирование, метрики, трассировка, модификация сообщений, централизованная обработка ошибок и т.д.

Существуют следующие точки расширения (хуки):

- **beforePublish(event, message)** – вызывается перед публикацией каждого сообщения. Здесь вы можете, например, добавить общий заголовок, провести валидацию или записать в лог факт отправки. Если эта функция вернёт `false`, сообщение не будет опубликовано (можно использовать для фильтрации событий).
- **afterPublish(event, message, messageId)** – вызывается после успешной отправки сообщения в Redis. `messageId` – идентификатор записи в Stream (или число получателей при Pub/Sub). Этот хук удобен для сбора метрик: например, учитывать количество отправленных событий, время отправки, либо для более подробного логирования (с ID).
- **beforeProcess(event, message, context)** – вызывается непосредственно перед передачей сообщения в пользовательский обработчик (подписчика). Можно использовать для подготовки контекста (например, запуск таймера для измерения длительности обработки, лог «начали обработку messageId» и т.п.). Если вернуть `false`, обработчик пользователя не будет вызван, а сообщение будет считаться *пропущенным* (его всё равно нужно будет ack-нуть или retry-ить – будьте осторожны с таким поведением).
- **afterProcess(event, message, context)** – вызывается после успешной обработки сообщения (т.е. после того, как пользовательский handler отработал без ошибки и сообщение ack-нуто). Тут можно остановить таймер и зафиксировать длительность, залогировать успешную обработку, обновить счётчики и т.д.
- **onError(event, message, context, error)** – вызывается, если пользовательский обработчик выбросил исключение или вернул rejected Promise. Позволяет централизованно обработать ошибки. По умолчанию rotif просто логирует неперехваченную ошибку (чтобы она не была подавлена), а затем запускает механизм повторов/DLQ. Если вы предоставите свою функцию onError, вы можете, например, логировать ошибку в внешнюю систему мониторинга. Если ваша реализация onError вернёт `false`, rotif **не будет выполнять стандартный процесс обработки ошибки** (то есть не будет делать retry и не отправит сообщение в DLQ). Это дает вам полный контроль: например, вы можете решить по типу ошибки не повторять, а сразу отправить в DLQ вручную, или вовсе подавить ошибку. Возвращайте `false` осмотрительно.

Подключение хуков:
- Глобально при создании `NotificationManager` через опции (как было описано в разделе конфигурации, например: `new NotificationManager({ beforePublish: ..., onError: ... })`).
- Локально для конкретной подписки через опции `subscribe` (как показано выше). Например:
  ```typescript
  manager.subscribe('event.name', handler, { 
    group: 'g1',
    beforeProcess: (msg, ctx) => { /* ... */ },
    onError: (msg, ctx, err) => { /* ... */ }
  });
  ```
  Локальные хуки переопределяют глобальные для этого события.

**Пример: логирование через хуки**

```typescript
const manager = new NotificationManager({
  beforePublish: (event, message) => {
    console.debug(`[Publish] ${event}:`, message);
  },
  afterPublish: (event, message, id) => {
    console.debug(`[Published] ${event} -> ID ${id}`);
  },
  beforeProcess: (event, message, ctx) => {
    console.debug(`[Process] ${event} (ID=${ctx.id}, attempt=${ctx.attempt})`);
  },
  afterProcess: (event, message, ctx) => {
    console.debug(`[Processed] ${event} (ID=${ctx.id}) successfully.`);
  },
  onError: (event, message, ctx, error) => {
    console.error(`[Error] ${event} (ID=${ctx.id}, attempt=${ctx.attempt}):`, error);
    // Возврат undefined или true позволяет запустить стандартный retry/DLQ
    // Если вернуть false, то rotif не будет ретраить/класть в DLQ автоматически
  }
});
```

С такими хуками каждый этап прохода сообщения через систему будет залогирован. Вы можете развивать идею: например, измерять время от beforeProcess до afterProcess и сохранять метрику, или в onError различать типы ошибок и делать `return false` только для некоторых (беря управление ретраем на себя). Хуки делают библиотеку более гибкой под ваши требования.

## Статистика подписки

Каждый вызов `subscribe()` возвращает объект **Subscription**, предоставляющий методы для управления подпиской. Один из полезных методов – `stats()`, который выдаёт текущую статистику работы подписки.

Вы можете вызвать `Subscription.stats()` в любой момент (например, по таймеру или при получении сигнала) для получения информации:
- **`event`** – имя события, на которое выполнена подписка.
- **`mode`** – режим подписки: `"stream"` или `"pubsub"`.
- **`group`** – название группы (если Streams), либо `null` для Pub/Sub.
- **`consumer`** – имя consumer-а (для Streams) или `null` для Pub/Sub.
- **`connected`** – состояние подключения (например, `true` если подписка активна; `false` если была отписка или потеря соединения).
- **`received`** – общее количество сообщений, полученных подпиской (включая успешно обработанные, в процессе и дубли).
- **`processed`** – количество сообщений, успешно обработанных и подтверждённых.
- **`failed`** – число сообщений, обработка которых завершилась ошибкой (и потребовался ретрай или уход в DLQ).
- **`retries`** – сколько раз в сумме происходили повторы для сообщений данной подписки.
- **`pending`** – (для Streams) текущее количество сообщений в статусе *pending* у данной группы (возможно с разбивкой по consumer-ам, если несколько). Это те сообщения, которые были доставлены, но еще не подтверждены. Например, если обработчик завис или работает очень медленно, pending может быть > 0. В Pub/Sub такой метрики нет.
- **`lastMessageId`** – идентификатор последнего обработанного сообщения (Streams) или отметка времени последнего сообщения (Pub/Sub).
- **`uptime`** – время в миллисекундах с момента запуска подписки.
- Возможно, другие поля (в зависимости от версии библиотеки, статистика может расширяться).

**Пример использования `stats()`:**

```typescript
const sub = manager.subscribe('trade.executed', onTrade, { group: 'trades' });
// ... спустя некоторое время
const stats = sub.stats();
console.log('Статистика подписки:', stats);
```

Вы можете периодически выводить или отправлять эту статистику в monitoring. Например, `processed` и `failed` помогут понять, сколько сообщений успешно обработано, а сколько упало, `pending` – признак, нет ли "зависших" сообщений, `retries` – индикатор нагрузки на механизм повторов.

Также объект Subscription позволяет отписаться: `sub.unsubscribe()`. При отписке соединения (блокирующее чтение Streams или подписка на канал) будут закрыты корректно.

## Эксплуатация и масштабирование

При использовании rotif в реальном проекте важно понимать некоторые аспекты, связанные с Redis и общим масштабированием системы. В этом разделе – рекомендации и описание поведения в продакшене, в том числе при кластерной установке, отказах и росте нагрузки.

### Использование Redis Streams в продакшене

Redis Streams – мощный механизм, обеспечивающий надежную очередь сообщений. Чтобы эффективно применять его, учтите следующее:

- **Команды, используемые библиотекой:** rotif под капотом использует следующие команды Redis:
  - `XADD` – для добавления новых сообщений в поток (при вызове `publish` в режиме Streams). В продакшене стоит подумать об ограничении роста стримов: вы можете настроить `maxStreamLength` (как описано выше) или периодически вызывать `XTRIM` для старых сообщений.
  - `XGROUP CREATE` – для создания групп потребителей (выполняется один раз при первой подписке с новым именем группы). Используется с опцией `MKSTREAM` (если поток не существует, он будет создан).
  - `XREADGROUP` – для чтения новых сообщений группой. Библиотека обычно вызывает `XREADGROUP GROUP groupName consumerName STREAMS streamName id` где `id` — либо `>` (для блокирующего чтения новых сообщений), либо конкретный ID (например, `0` или другое, если нужно читать историю).
    * Блокирующий режим: rotif использует `BLOCK` с таймаутом (например, 1-5 секунд) или без таймаута, чтобы долго удерживать соединение, ожидая новые данные. Это обеспечивает малую задержку доставки без активного опроса.
  - `XACK` – подтверждение обработки. Вызывается автоматически после выполнения обработчика (если не включен manualAck).
  - `XDEL` – явное удаление сообщений из стрима. **rotif по умолчанию не удаляет сообщения из потока после XACK**, так как может быть несколько групп (другие группы еще не прочитали это сообщение). Но если вы уверены, что используете только одну группу (или не храните долгий backlog), вы можете самостоятельно время от времени чистить поток. Либо, если у вас одна группа, можно настроить опцию, чтобы после XACK вызывать XDEL (в текущей версии такого флага может не быть, но возможно появится).
  - `XPENDING` / `XINFO` – служебные команды, используемые для диагностики и статистики. Например, `stats()` вызывает `XINFO GROUPS` или `XPENDING` чтобы узнать число pending сообщений и др.
  - `XCLAIM` / `XAUTOCLAIM` – используются для реализации retry. `XAUTOCLAIM` (с Redis 6.2) позволяет получить сообщение из pending, если оно висит более N миллисекунд, и перевести его на текущего consumer-а. Если Redis версии 6.2+, rotif использует XAUTOCLAIM (более эффективно, может сразу несколько сообщений вернуть). Если версия 5.0–6.0, используется XCLAIM для одного сообщения за раз.
  - `ZADD` / `ZPOPMIN` – используются для отложенных сообщений (добавление в отсортированное множество и выборка самых ранних для доставки).
- **Ограничение длины стрима:** если вы не будете удалять или обрезать старые сообщения, Redis Stream может расти бесконечно, занимая память. Для постоянно генерируемых событий настройте политику очистки:
  - Вариант 1: `maxStreamLength` (approx trimming) – при каждом XADD Redis сам будет удалять старые записи свыше заданного. Это очень удобно, но учтите: *точное* обрезание (без ~) может блокировать Redis на длительное время при большом объёме, лучше использовать approximate (`~`).
  - Вариант 2: Использовать TTL на ключ стрима через вызов `EXPIRE`. Однако это удалит **весь** стрим спустя время, так что не подходит, если он постоянно используется.
  - Вариант 3: Периодически (например, раз в сутки) переноси старые сообщения в архив (другой ключ) или просто удалять, если они не нужны. Можно через `XTRIM` или `XDEL` по диапазону ID.
  - Если у вас несколько групп, подумайте, все ли они успевают читать до удаления. У каждого стрима есть параметр `last_delivered_id` для каждой группы – удалять записи старше самого малого из этих ID безопасно (все группы их уже получили).
- **Производительность:** Redis Streams довольно эффективны, но при очень высокой нагрузке (десятки тысяч сообщений в секунду) следите за:
  - Задержкой команд XREADGROUP (в больших стримах поиск следующего сообщения может занимать время, хотя Redis оптимизирован для последовательного чтения).
  - Накоплением pending-листа: если потребители не успевают, `XPENDING` может расти. Это сигнал либо увеличить число потребителей (горизонтально), либо поток обработки (оптимизировать handler), либо разбить событие на несколько стримов.
  - **Триммирование**: помогает держать размер стрима в узде, но если retention слишком мал, риск, что медленные потребители не успеют получить сообщения до удаления.

В целом, Streams подходят для продакшена при соблюдении этих мер. Их плюс – надежность, минус – чуть большая сложность в управлении (в сравнении с Pub/Sub).

### Поддержка Redis Cluster

rotif может работать с Redis Cluster. Есть несколько особенностей и ограничений при этом:
- **Подключение:** используйте либо клиент `ioredis`, который автоматически работает с кластером (передав его через `redisOptions`/`client`), либо node-redis v4 с настройкой cluster. Вы можете указать несколько URL узлов (например, `redisUrls: ['redis://host1:6379', 'redis://host2:6379']`) – тогда библиотека попытается соединиться к кластеру. В противном случае, указав один `redisUrl`, вы подключитесь только к одному узлу. Так как rotif использует стандартные команды, Redis Cluster сам перенаправит их на нужные шарды в зависимости от ключей.
- **Ключи и хеш-слоты:** Имя события (`event`) используется как ключ для Redis Stream и/или канала. В Redis Cluster каждый ключ принадлежит опредёлённому shard по алгоритму хеширования. Важный момент – **команды с несколькими ключами** (например, `XREADGROUP` может читать с нескольких стримов сразу, или `XINFO` для разных ключей) работают только если все ключи на одном шарде (в одном slot). В текущей версии rotif каждая подписка оперирует одним стримом, поэтому проблемы multi-key обычно нет. Но если бы вы использовали, скажем, `manager.subscribe(['ev1','ev2'], ...)` (в этой версии, кажется, нет такого – подписываемся по одному), то не гарантировано, что `ev1` и `ev2` в одном слоте и Redis бы выдал *CROSSSLOT* ошибку. Поэтому:
  - Старайтесь избегать общих операций над разными событиями в одном вызове.
  - Если очень нужно сгруппировать события, используйте ключевые теги Redis: например, названия `event1-{proj}`, `event2-{proj}` – тогда часть в `{}` игнорируется при хешировании и оба ключа будут на одном слоте.
- **Pub/Sub в кластере:** Обычный (глобальный) Pub/Sub в Redis Cluster работает, но с оговорками: команда `PUBLISH` отправляется на конкретный узел по хешу канала, а потом Redis распространяет сообщение по внутренней шине на все узлы. То есть подписчик, подключенный к любому узлу, получит сообщение. Однако, это может стать узким местом при очень большом трафике (каждое сообщение распространяется на весь кластер). Redis 7.0 ввёл **Sharded Pub/Sub** (команды SSUBSCRIBE/SPUBLISH), где сообщение остается в пределах одного shard – но rotif пока не использует эти команды. Поэтому, при использовании Pub/Sub на кластере:
  - Если у вас тысячи сообщений в секунду по каналам, будьте готовы к нагрузке на кластерную шину. Можно рассмотреть sharded pubsub (но придётся самостоятельно использовать ioredis и методы).
  - Все подписчики через rotif в режиме pubsub подключаются к одному узлу (вероятно тому, что в `redisUrl`). Это означает, если узел кластера упадет, подписки прервутся (независимо от того, есть другие узлы). Решение: либо на уровне клиента обеспечить автоматический перескок подписки на другой узел, либо использовать несколько `NotificationManager` к разным узлам. В целом, Streams надёжнее в кластере, т.к. *consumer group* привязан к ключу на конкретном shard, и при падении узла Redis Cluster сам выполнит failover (переключит на реплику) и вы продолжите работу.
- **Число потоков и шардов:** Можно распределять события по разным узлам, просто выбирая имена так, чтобы они хешировались в разные слоты. Это может повысить пропускную способность (разные стримы пишутся/читаются разными узлами параллельно). Но обычно узкое место – не запись стрима, а обработка или сеть, так что это делается по необходимости.
- **Итог:** rotif поддерживает кластерный режим, но для критичных систем тестируйте сценарии перетасовки слотов и отказа узлов. Библиотека полагается на клиента Redis для обработки MOVED/ASK ответов. Также учитывайте, что `XAUTOCLAIM`/`XCLAIM` должны вызываться на мастере; если в кластере произошёл failover, старый consumer может пытаться claim на уже реплику – node-redis/ioredis должны автоматически направлять команду мастеру.

### Поведение при сбоях

Рассмотрим, как ведёт себя система при различных проблемных ситуациях:

- **Недоступен Redis сервер:** Если соединение с Redis разорвалось (сервер упал или сеть недоступна), то:
  - Все операции публикации будут либо ждать восстановления соединения, либо выбрасывать ошибки (зависит от настроек клиента Redis; по умолчанию node-redis будет пытаться переподключаться автоматически). Ваша программа может получить исключение при вызове `publish` (если клиент настроен не буферизовать или истек таймаут). Рекомендуется обрабатывать такие ошибки: например, ставить сообщения во временный буфер/очередь в памяти и пытаться отправить позже.
  - Подписки Streams (XREADGROUP) и Pub/Sub, выполняемые блокирующим образом, обнаружат разрыв соединения. rotif настроен автоматически переподписываться: т.е. после восстановления связи он вновь выполнит `XREADGROUP` или `SUBSCRIBE` с последней известной позиции. Для Streams это означает, что messages, которые были добавлены во время недоступности Redis, будут получены (если группа существовала – они просто ждали). Для Pub/Sub – сообщения, отправленные во время простоя, потеряны.
  - В период недоступности Redis новые сообщения, публикуемые с `delayMs`/`deliverAt`, будут поставлены в локальную очередь (возможно, клиент node-redis их буферизует). Но если Redis не вернётся, они могут быть потеряны. Лучше в критичных системах при потере Redis переключаться на резервный или сигнализировать о проблеме.
- **Падение/рестарт потребителя:** Если приложение или процесс, выполняющий `subscribe`, неожиданно завершается:
  - **Streams:** Все сообщения, которые были выданы этому consumer-у и ещё не подтверждены (`XACK`), останутся в Pending. Они не пропадут, потому что хранятся в Redis. Однако без вмешательства они и не будут обработаны, т.к. помечены за конкретным consumer (который уже не существует). Чтобы не потерять их, другие активные потребители в группе должны их "забрать". Здесь вступает механизм **зомби-консюмеров**: rotif периодически проверяет pending сообщения с истекшим временем (больше `retryDelay`) и осуществляет `XCLAIM/XAUTOCLAIM` на них в контексте активного consumer-а. Таким образом, если один из экземпляров упал, через интервал retry его незавершённые сообщения перейдут к работающему экземпляру и будут обработаны повторно. Это и есть тот же механизм retry.
    - Если же все экземпляры группы упали (т.е. некому забирать), сообщения останутся pending до запуска хотя бы одного подписчика. Когда вы перезапустите подписчика с тем же именем consumer или с новым именем, rotif при старте выполнит `XAUTOCLAIM` всех старых (idle) сообщений на себя и начнёт их обрабатывать. Поэтому, после простоя, первые полученные сообщения могут быть "старые", которые не были завершены ранее.
    - В случае, когда consumer упал **после** успешной обработки, но до того как успел отправить XACK (например, приложение упало между обработкой и подтверждением) – Redis не знает, что обработка была успешной. Такое сообщение тоже будет переназначено как не обработанное. Здесь дедупликация спасает: второй раз выполнив обработчик, вы можете понять, что это дубликат (например, операция уже выполнена, скажем платеж проведен) и просто проигнорировать. Поэтому для критически важных эффектов (внешних действий) – всегда делайте их идемпотентными или используйте dedupKey.
  - **Pub/Sub:** Если подписчик (consumer) упал, все сообщения, которые публиковались во время его отсутствия, потеряны для него (другие подписчики, если были, получили). Когда он перезапустится и подпишется заново, он будет получать только новые сообщения. Поэтому сбоев подписчика Pub/Sub лучше не допускать в ответственных системах, либо делать так, чтобы сообщения не являлись критичными.
- **Накопление "зависших" сообщений (зомби-консюмер):** Зомби-консюмер – это consumer, который давно не активен, но в pending висит множество сообщений за ним. Такое может случиться, если:
  - Либо у вашего обработчика произошёл deadlock/зависание и он перестал обрабатывать, но соединение не закрылось. Тогда Redis считает consumer живым, но он ничего не подтверждает. Другие в группе не заберут pending, потому что формально consumer активен. Для таких случаев реализуйте таймауты в обработке или используйте `manualAck` с внешним контролем, но это сложно. Проще: наблюдайте за метрикой `pending`. Если она растёт а `processed` нет – значит потребитель завис.
  - Либо consumer завершился не закрыв соединение (например, kill -9, и Redis ещё не понял что соединение мертво). Redis поймёт это через какое-то время tcp-timeout и тогда можно будет claim. Обычно `retryDelay` ставят больше, чем такой таймаут, чтобы XAUTOCLAIM не случился раньше времени.
  - rotif старается решить проблему: при каждой итерации чтения он может вызывать `XAUTOCLAIM` для сообщений старше `retryDelay` * 2 (например). Это гарантирует, что даже если consumer просто не ack, через какое-то время сообщения будут выданы другому. Но будьте внимательны: если обработка долгую время занимает (легально, например обработчик обрабатывает 1 сообщение 1 минуту), нужно увеличить `retryDelay` соответственно, иначе rotif подумает, что сообщение зависло, и передаст его другому, в итоге параллельно два обработчика могут работать над одним – нехорошо. Поэтому настраивайте `retryDelay` >= максимального времени обработки или используйте manualAck, совершая ack только когда точно закончили (при этом отключив авто-ретраи).
- **Повторная доставка того же сообщения несколько раз одновременно:** такого не должно случиться при корректных настройках, но, как описано, возможно если неправильно выбран timeout. Дедупликация поможет смягчить эффект.

Резюме: Streams+Groups в сочетании с ретраями предоставляют достаточно устойчивую к сбоям систему, если правильно настроить интервалы и следить за метриками. Pub/Sub прост, но не даёт защиты – используйте его там, где сообщения не критично потерять.

### Лучшая практика: группы, консюмеры и горизонтальное масштабирование

rotif изначально спроектирован для горизонтального масштабирования – вы можете запустить несколько экземпляров сервиса, и они будут разделять нагрузку по обработке сообщений.

**Группы vs отдельные стримы:**  
- Если два независимых сервиса должны получать все события определённого типа (каждый в своих целях) – используйте **разные группы** на одном стриме. Пример: событие `"user.registered"` должно обработать сервис A (отправить приветственное письмо) и сервис B (начислить бонусы). Можно завести стрим `"user.registered"`, группу `"mailService"` и группу `"bonusService"`. Тогда каждое событие будет помещено в один стрим, но читаться в рамках разных групп (каждая со своей позицией и pending). Таким образом, оба сервиса получат каждое сообщение, но друг другу не мешают.
- Если два или более экземпляров **одного сервиса** должны *разделять* обработку событий – используйте **одну группу** и несколько consumer-ов. Например, у нас 3 копии сервиса A (в трех контейнерах). Они все подписываются на `"user.registered"` с одной группой `"mailService"`, но с разными именами consumer (можно задать через ENV hostname). Тогда Redis будет балансировать сообщения между ними (как на диаграмме выше: 1 -> C1, 2 -> C2...). Это и есть конкурирующие потребители, увеличивающие throughput.
- Не рекомендуется создавать отдельный стрим на каждую копию сервиса – иначе они не будут делить сообщения, каждый будет иметь свой стрим с полным набором событий, что не то, что нужно, плюс больше ключей.
- **Pub/Sub** по сути аналогичен: все подписчики на канал получают все сообщения (что похоже на «каждый со своей группой» для Streams). Но в Pub/Sub нельзя сделать конкурирующих потребителей – если вам надо разделять нагрузку, придётся как-то самостоятельно координировать (обычно это решают не Pub/Sub, а очередью). Поэтому для load balancing лучше Streams.

**Именование групп и consumer-ов:**  
- Дайте группам понятные имена, связанные с логикой сервиса или задачей. Например, `"orderService"`, `"billing"`, `"notifications"`.
- Consumer name (имя экземпляра) может выбираться автоматически, но вы можете задать его вручную для удобства мониторинга. Хороший вариант – включить hostname или идентификатор процесса: `"orderService-<hostname>-<pid>"`. Максимальная длина имени – consumer group имя/consumer имя в Redis ограничено 64 байт, так что не делайте очень длинными.
- Если вы деплоите новую версию сервиса, сохраняйте ту же group, иначе получите две конкурирующие группы и каждое событие начнёт дублироваться (в каждой группе). Если вам нужно так (например, плавный запуск нового сервиса параллельно старому), то учтите, что старые сообщения из стрима новая группа не увидит (если создана с `$`), либо увидит все (если с `0`). Обычно это не требуется – проще разделять события на уровне имен.
- **Количество групп:** Redis Streams легко держат десятки групп на один стрим. Но тысячи – могут начать сказываться на скорости XADD (каждая группа хранит last_id и pending). Не злоупотребляйте: если вам кажется, что нужна группа на каждого пользователя, значит, возможно, стоит использовать другой механизм (напр. отдельные стримы или вовсе Sorted Set).
- **Horizontal scaling:** Масштабирование достигается запуском дополнительных потребителей:
  - При росте входящего потока сообщений, если один процесс не справляется, поднимите второй с той же группой. Они будут параллельно обрабатывать вдвое больше. Аналогично третий, четвертый и т.д. Обычно масштабируется почти линейно, пока Redis не станет узким местом или сам handler (например, внешний API).
  - Масштабировать **отправителей** (publish) просто – любая часть кода может публиковать в стрим, Redis справится, хотя при экстремальной нагрузке 1 стрим/группа упрётся в один поток выполнения на Redis. В кластере можно распределять по shard'ам, как сказано выше.
  - **Внимание:** следите за метриками. Если даже после добавления consumer-ов pending постоянно растёт, значит скорость прихода > скорости обработки. Надо или ещё увеличить потребителей, или отложить часть задач, или увеличить мощность машин.

**Можно ли использовать Pub/Sub в продакшене?**  
Это часто задаваемый вопрос, вынесем его отдельно (ещё раз): да, Pub/Sub можно использовать, но помните:
- Нет гарантии доставки – если ваш подписчик не успел или был отключен, данные ушли.
- Нет очереди, распределения нагрузки – каждый подписчик получает всё.
- Зато latency минимальна, и нет накладных расходов на хранение/подтверждение.
- Практический совет: применяйте Pub/Sub для некритичных вещей: уведомления в UI (например, прогресс задачи, где потеря одного обновления некритична), обновление кэша (если пропущено – в следующий раз обновится), логирование, метрики. Для всего, что влияет на бизнес-логику (заказы, деньги, состояния) – Streams с подтверждением.
- Ещё вариант: можно комбинировать. Например, Streams использовать внутри системы для надёжности, а Pub/Sub для дублирования важных событий наружу (на WebSocket серверы, и т.п., где тоже нет смысла гарантировать, если клиент ушёл).

## FAQ / Часто задаваемые вопросы

**Q: Почему сообщения не доставляются подписчикам?**  
**A:** Возможны несколько причин:
- Убедитесь, что подписка выполнена на точно тот же `event` (название), что используется при публикации. Опечатки или несовпадение имен каналов – самая частая проблема.
- Если вы публикуете без указания `delay`/`deliverAt`, а подписчик настроен через Pub/Sub, то подписчик должен быть запущен *до* публикации. Иначе сообщение некому доставлять и оно теряется. Решение: запускать подписчики раньше отправителей, либо использовать Streams.
- Если используется Streams и группа, а сообщения не приходят: возможно, не была создана группа. rotif создает группу автоматически при подписке; если же вы пытались читать без группы, убедитесь что не используете `{ pubsub: true }` случайно. Также, если группа создана, но вы указали начало чтения с `$`, то сообщения, добавленные *до* момента создания группы, не будут получены (это нормально). Если нужно прочитать старые – создавайте группу с ID `0` (сделать можно вручную в Redis-cli).
- Проверьте соединение с Redis. Если подписчик не подключён (например, Redis недоступен), конечно, он не получит ничего. В `Subscription.stats()` флаг `connected` покажет статус.
- Сообщения могли быть отправлены в DLQ сразу, минуя обработчик (в случае, если dedup посчитал их дубликатами или другие экстремальные случаи). Посмотрите, нет ли данных в DLQ-потоке.
- Наконец, если вы используете Redis Cluster и подписка/публикация идут на разные узлы (разные hash-slot), может быть ситуация, что подписчик слушает один узел, а publish ушел на другой (для Pub/Sub). Для Streams это неважно, Redis перенаправит внутри к правильному, но pub/sub может требовать подключение ко всем узлам или использование `SPUBLISH/SSUBSCRIBE` для шардинга. Решение: либо подключаться через не-кластерный endpoint (например, через Twemproxy, который не поддерживает pubsub? или через Sentinel?), либо избегать pubsub в кластере, либо знать узел ключа. Проще – использовать Streams.

**Q: Как работает механизм retry?**  
**A:** При ошибке в обработчике подписчика (только Streams) сообщение остаётся необработанным и попадает в Pending. rotif отслеживает время, прошедшее с момента, когда сообщение стало pending. Когда проходит интервал `retryDelay` (или первый элемент из массива `retryAttempts`), библиотека с помощью команды Redis `XAUTOCLAIM` забирает сообщение из pending и снова ставит его в очередь на обработку. Поле `attempt` увеличивается. Это повторяется, пока количество попыток не превысит лимит. Между попытками всегда есть пауза – *сообщение не будет доставлено раньше, чем истечёт заданная задержка*. Если все попытки исчерпаны, сообщение отправляется в DLQ. Если в какой-то момент сообщение обработалось успешно, оно `XACK` подтверждается и удаляется из pending, на этом цикл завершается. Важный момент: если приложение перезапустилось, оно при старте сделает `XAUTOCLAIM` всех сообщений, чей *idle time* больше, чем порог (retryDelay), поэтому они тоже будут повторно обработаны. В совокупности это даёт поведение, близкое к традиционным системам очередей с повторными попытками.

**Q: Как диагностировать "зависшие" сообщения в стриме?**  
**A:** "Зависшими" обычно называют сообщения, которые находятся в pending слишком долго и не перераспределяются. Для диагностики:
- Используйте команду `XPENDING <stream> <group>` через redis-cli. Она покажет диапазон ID в pending и количество сообщений, а с опцией `<start> <end> <count>` можно получить конкретные ID и какой consumer держит. Если видите, что есть много pending, привязанных к consumer, который уже не активен – это и есть зомби. Также `XINFO CONSUMERS <stream> <group>` покажет потребителей и сколько у каждого pending.
- В `Subscription.stats()` поле `pending` и, возможно, детали pending (если библиотека предоставляет) могут подсказать ситуацию. Если pending не 0 и не уменьшается – значит какие-то сообщения не подтверждаются.
- rotif автоматически должен re-claim таких зомби сообщения, но если этого не происходит, убедитесь, что `retryAttempts` не 0 и что `retryDelay` адекватен. Возможно, сообщения висят меньше, чем `retryDelay`, и ещё не считаются затянутыми (тогда всё ок). Если же висят дольше `retryDelay*2` – что-то не так: либо onError возвращает false и отключил ретраи, либо процесс, который должен забирать, не работает.
- Вы можете вручную вызвать (с осторожностью) метод `subscription.reclaimPending()` если он есть (или через redis-cli `XAUTOCLAIM`) указав время поменьше, чтобы забрать все зависшие сообщения. После этого они пойдут на retry.
- Лучше заранее проектировать, чтобы таких ситуаций не было: настраивать правильный `retryDelay` (больше максимального времени обработки + запас), следить за consumer-ами.

**Q: Можно ли использовать Pub/Sub в production?**  
**A:** Да, но учитывайте ограничения. Pub/Sub в Redis обеспечивает очень быструю доставку, однако:
- Доставка **не гарантируется**: если получателя нет онлайн, сообщение не сохранится.
- Семантика **at-most-once**: сообщение либо дойдет один раз, либо не дойдет вовсе (например, при сбое).
- Нет автоматических ретраев и очереди ожидания. Если обработка упала, система никак это не узнает.
- Поэтому Pub/Sub годится для не критичных уведомлений (см. выше). Например, транслировать состояние, отправлять события для real-time обновления интерфейса – нормально. Использовать его для межсервисной коммуникации, где важна надежность, не рекомендуется.
- В продакшене часто делают так: критичные вещи – через Streams, а поверх, если нужно мгновенное оповещение, дублируют Pub/Sub. Также, если у вас очень высоконагруженная система, и Kafka/RabbitMQ избыточны, Redis Streams могут заменить их, а Pub/Sub – заменить многоканальные broadcast, но все же знайте риски.
- **Вывод:** использовать Pub/Sub можно, но помните о резервном плане: например, если вы рассылали уведомления пользователей через Pub/Sub и какой-то выпал, хорошо бы иметь периодический консистентный процесс, который проверит, что все получили (или клиент сам запросит на сервере, если пропустил). Ничто не мешает комбинировать: отправили pubsub для скорости и стрим для надежности параллельно.

## Вклад и структура проекта

Мы приветствуем вклад сообщества в развитие rotif! Проект открыт исходным кодом, и вы можете найти репозиторий на GitHub (ссылка указана в package.json). 

**Структура проекта:**
- **`src/`** – исходники библиотеки (на TypeScript). Внутри находятся основные модули:
  - `NotificationManager.ts` – основной класс, описанный выше.
  - `Subscription.ts` – класс, реализующий подписку (то, что возвращается из `subscribe`).
  - Другие файлы: `RedisClient.ts` (обёртка над подключением Redis), `ScheduledMessages.ts` (логика отложенных сообщений), `Deduplication.ts` (реализация дедуп хранилища), и т.д. Код организован по функциональным частям.
- **`test/`** – модульные тесты и интеграционные тесты. Там вы найдёте сценарии, проверяющие отправку/получение сообщений, ретраи, дедупликацию, и пр. (запускаются через `npm test`).
- **`examples/`** – примеры использования (если присутствуют). Можно посмотреть простейшие примеры, демонстрирующие подключение и различные режимы работы.
- **`dist/`** – собираемый выход (при сборке через tsc или bundler) – здесь формируется компилированный JS, распространяемый на npm.
- **Конфигурационные файлы**:
  - `tsconfig.json` – конфигурация TypeScript (целевой уровень ES, включение деклараций, модуль CommonJS/ESM).
  - `.eslintrc`, `.prettierrc` (если есть) – настройки линтера/форматирования кода.
  - `package.json` – содержит скрипты (например, `build`, `test`), зависимости (node-redis) и информацию о версии.
- **Документация** – README (данный файл) содержит основную документацию. Дополнительные сведения (например, CHANGELOG.md с описанием изменений версий, CONTRIBUTING.md с правилами вклада) также присутствуют, если вы хотите поучаствовать.

Чтобы внести вклад:
1. Форкните репозиторий на GitHub, создайте ветку для своей фичи или исправления.
2. Убедитесь, что ваш код покрыт тестами. Добавьте тесты в `test/` на новый функционал либо регрессионные на исправленный баг.
3. Запустите `npm run lint` и `npm test` – все тесты должны проходить, код соответствовать стилю.
4. Создайте Pull Request с описанием ваших изменений. Мейнтейнеры проекта рассмотрят его, дадут обратную связь или примут.
5. Обсуждения ведутся через issues в GitHub – если у вас есть предложения или нашли ошибку, пожалуйста, создайте issue.

Мы стараемся придерживаться семантического версионирования. Любые изменения, ломающие обратную совместимость, будут повышать мажорную версию. Ваш вклад должен соответствовать текущему стилю кодирования и проектирования (SOLID, минимальная зависимость от конкретного клиента Redis и т.п.).

## Лицензия

Проект **rotif** распространяется на условиях лицензии MIT. Вы свободны использовать библиотеку в своих приложениях, изменять исходный код и распространять изменения с соблюдением условий MIT-лицензии. Полный текст лицензии доступен в файле [LICENSE](./LICENSE). Спасибо за использование rotif!