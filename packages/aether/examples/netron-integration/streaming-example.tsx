/**
 * Streaming Data with Netron Integration Example
 *
 * This example demonstrates real-time data streaming with:
 * - useStream hook for WebSocket subscriptions
 * - Auto-reconnection on disconnect
 * - Buffer management for accumulated data
 * - Throttling and filtering
 * - Multiple concurrent streams
 *
 * Use Cases:
 * - Real-time price feeds
 * - Live chat/notifications
 * - Server-sent events
 * - IoT sensor data
 * - Stock tickers
 */

import { defineComponent, signal, computed, onMount } from '@omnitron-dev/aether';
import { Injectable, Module, inject, bootstrapModule } from '@omnitron-dev/aether/di';
import {
  NetronModule,
  NetronService,
  useStream,
  useMultiStream,
  useBroadcast,
  Backend,
  Service,
} from '@omnitron-dev/aether/netron';

// ============================================================================
// CONTRACTS
// ============================================================================

// Price Feed Service
interface PriceUpdate {
  symbol: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  timestamp: Date;
}

interface IPriceFeedService {
  subscribePrices(symbols: string[]): Promise<AsyncIterable<PriceUpdate>>;
  unsubscribe(): Promise<void>;
}

// Chat Service
interface ChatMessage {
  id: string;
  userId: string;
  username: string;
  message: string;
  timestamp: Date;
}

interface IChatService {
  subscribeMessages(roomId: string): Promise<AsyncIterable<ChatMessage>>;
  sendMessage(roomId: string, message: string): Promise<void>;
  broadcastMessage(message: ChatMessage): Promise<void>;
}

// Sensor Service
interface SensorReading {
  sensorId: string;
  type: 'temperature' | 'humidity' | 'pressure';
  value: number;
  unit: string;
  timestamp: Date;
}

interface ISensorService {
  subscribeSensor(sensorId: string): Promise<AsyncIterable<SensorReading>>;
  subscribeSensors(sensorIds: string[]): Promise<AsyncIterable<SensorReading>>;
}

// Notification Service
interface Notification {
  id: string;
  type: 'info' | 'warning' | 'error' | 'success';
  title: string;
  message: string;
  timestamp: Date;
}

interface INotificationService {
  subscribe(userId: string): Promise<AsyncIterable<Notification>>;
  broadcast(notification: Omit<Notification, 'id' | 'timestamp'>): Promise<void>;
}

// ============================================================================
// SERVICES
// ============================================================================

@Injectable()
@Backend('main')
@Service('price-feed@1.0.0')
export class PriceFeedService extends NetronService<IPriceFeedService> {}

@Injectable()
@Backend('chat')
@Service('chat@1.0.0')
export class ChatService extends NetronService<IChatService> {}

@Injectable()
@Backend('iot')
@Service('sensors@1.0.0')
export class SensorService extends NetronService<ISensorService> {}

@Injectable()
@Backend('main')
@Service('notifications@1.0.0')
export class NotificationService extends NetronService<INotificationService> {}

// ============================================================================
// COMPONENTS
// ============================================================================

/**
 * Price Ticker - Real-time stock prices
 */
const PriceTicker = defineComponent<{ symbols: string[] }>((props) => {
  // Stream real-time price updates
  const {
    data: prices,
    error,
    status,
    connect,
    disconnect,
    clear,
  } = useStream<PriceFeedService, 'subscribePrices', PriceUpdate>(
    PriceFeedService,
    'subscribePrices',
    [props.symbols],
    {
      // Buffer last 100 price updates
      bufferSize: 100,

      // Throttle to max 10 updates per second
      throttle: 100,

      // Auto-reconnect on disconnect
      reconnect: true,
      reconnectDelay: 1000,
      reconnectMaxDelay: 10000,
      maxReconnectAttempts: 10,

      // Callbacks
      onData: (price) => {
        console.log('Price update:', price);
      },
      onConnect: () => {
        console.log('Connected to price feed');
      },
      onDisconnect: () => {
        console.log('Disconnected from price feed');
      },
      onError: (err) => {
        console.error('Price feed error:', err);
      },
    }
  );

  // Get latest price for each symbol
  const latestPrices = computed(() => {
    const priceMap = new Map<string, PriceUpdate>();
    prices().forEach(price => {
      priceMap.set(price.symbol, price);
    });
    return priceMap;
  });

  // Format price with color indicator
  const getPriceColor = (change: number) => {
    if (change > 0) return 'green';
    if (change < 0) return 'red';
    return 'gray';
  };

  return () => (
    <div class="price-ticker">
      <div class="ticker-header">
        <h2>Live Prices</h2>
        <div class="status">
          <span class={`status-indicator ${status()}`}>
            {status() === 'connected' && '🟢 Live'}
            {status() === 'connecting' && '🟡 Connecting...'}
            {status() === 'disconnected' && '🔴 Disconnected'}
            {status() === 'error' && '⚠️ Error'}
          </span>
        </div>
        <div class="controls">
          <button onClick={connect} disabled={status() === 'connected'}>
            Connect
          </button>
          <button onClick={disconnect} disabled={status() === 'disconnected'}>
            Disconnect
          </button>
          <button onClick={clear}>Clear</button>
        </div>
      </div>

      {error() && (
        <div class="error">Error: {error()!.message}</div>
      )}

      <div class="ticker-list">
        {props.symbols.map(symbol => {
          const price = latestPrices().get(symbol);
          return (
            <div key={symbol} class="ticker-item">
              <div class="symbol">{symbol}</div>
              {price && (
                <>
                  <div class="price">
                    ${price.price.toFixed(2)}
                  </div>
                  <div
                    class="change"
                    style={{ color: getPriceColor(price.change) }}
                  >
                    {price.change >= 0 ? '+' : ''}
                    {price.change.toFixed(2)} ({price.changePercent.toFixed(2)}%)
                  </div>
                  <div class="volume">
                    Vol: {(price.volume / 1000000).toFixed(2)}M
                  </div>
                </>
              )}
              {!price && <div class="no-data">Waiting for data...</div>}
            </div>
          );
        })}
      </div>

      <div class="ticker-footer">
        <div class="update-count">
          Updates received: {prices().length}
        </div>
      </div>
    </div>
  );
});

/**
 * Chat Room - Real-time chat with broadcasting
 */
const ChatRoom = defineComponent<{ roomId: string; userId: string }>((props) => {
  const messageInput = signal('');

  // Subscribe to chat messages
  const {
    data: messages,
    error,
    status,
  } = useStream<ChatService, 'subscribeMessages', ChatMessage>(
    ChatService,
    'subscribeMessages',
    [props.roomId],
    {
      // Keep last 50 messages
      bufferSize: 50,

      // Auto-connect on mount
      autoConnect: true,

      // Auto-reconnect
      reconnect: true,
      reconnectDelay: 2000,

      onData: (message) => {
        // Play notification sound for new messages
        if (message.userId !== props.userId) {
          console.log('New message from', message.username);
        }
      },
    }
  );

  // Send message (mutation)
  const {
    broadcast: sendMessage,
    broadcasting,
    error: sendError,
  } = useBroadcast<ChatService, 'broadcastMessage', ChatMessage>(
    ChatService,
    'broadcastMessage'
  );

  const handleSendMessage = async () => {
    if (messageInput().trim()) {
      await sendMessage({
        id: `msg-${Date.now()}`,
        userId: props.userId,
        username: 'User',
        message: messageInput(),
        timestamp: new Date(),
      });
      messageInput.set('');
    }
  };

  return () => (
    <div class="chat-room">
      <div class="chat-header">
        <h3>Chat Room: {props.roomId}</h3>
        <span class={`status-badge ${status()}`}>
          {status()}
        </span>
      </div>

      {error() && (
        <div class="error">Connection error: {error()!.message}</div>
      )}

      <div class="chat-messages">
        {messages().map(msg => (
          <div
            key={msg.id}
            class={`message ${msg.userId === props.userId ? 'own' : 'other'}`}
          >
            <div class="message-header">
              <strong>{msg.username}</strong>
              <span class="timestamp">
                {new Date(msg.timestamp).toLocaleTimeString()}
              </span>
            </div>
            <div class="message-body">{msg.message}</div>
          </div>
        ))}
      </div>

      {sendError() && (
        <div class="error">Failed to send: {sendError()!.message}</div>
      )}

      <div class="chat-input">
        <input
          type="text"
          value={messageInput()}
          onInput={(e) => messageInput.set((e.target as HTMLInputElement).value)}
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleSendMessage();
            }
          }}
          placeholder="Type a message..."
          disabled={status() !== 'connected' || broadcasting()}
        />
        <button
          onClick={handleSendMessage}
          disabled={status() !== 'connected' || broadcasting() || !messageInput().trim()}
        >
          {broadcasting() ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
});

/**
 * Sensor Dashboard - Multiple concurrent streams
 */
const SensorDashboard = defineComponent<{ sensorIds: string[] }>((props) => {
  // Subscribe to multiple sensors simultaneously
  const sensorStreams = useMultiStream(
    props.sensorIds.map(id => ({
      service: SensorService,
      method: 'subscribeSensor',
      args: [id],
      options: {
        bufferSize: 20,
        reconnect: true,
        throttle: 500, // Max 2 updates per second per sensor
      },
    }))
  );

  // Get latest reading for each sensor
  const latestReadings = computed(() => {
    return props.sensorIds.map((id, index) => {
      const stream = sensorStreams[index];
      const readings = stream.data();
      return readings.length > 0 ? readings[readings.length - 1] : null;
    });
  });

  // Average temperature
  const avgTemperature = computed(() => {
    const temps = latestReadings()
      .filter(r => r && r.type === 'temperature')
      .map(r => r!.value);
    return temps.length > 0
      ? temps.reduce((sum, val) => sum + val, 0) / temps.length
      : 0;
  });

  return () => (
    <div class="sensor-dashboard">
      <h2>IoT Sensor Dashboard</h2>

      <div class="summary">
        <div class="summary-item">
          <strong>Active Sensors:</strong>{' '}
          {sensorStreams.filter(s => s.status() === 'connected').length} /{' '}
          {props.sensorIds.length}
        </div>
        <div class="summary-item">
          <strong>Avg Temperature:</strong> {avgTemperature().toFixed(1)}°C
        </div>
      </div>

      <div class="sensor-grid">
        {props.sensorIds.map((id, index) => {
          const stream = sensorStreams[index];
          const reading = latestReadings()[index];

          return (
            <div key={id} class="sensor-card">
              <div class="sensor-header">
                <h4>Sensor {id}</h4>
                <span class={`badge ${stream.status()}`}>
                  {stream.status()}
                </span>
              </div>

              {stream.error() && (
                <div class="error">{stream.error()!.message}</div>
              )}

              {reading && (
                <div class="sensor-data">
                  <div class="reading-type">{reading.type}</div>
                  <div class="reading-value">
                    {reading.value.toFixed(2)} {reading.unit}
                  </div>
                  <div class="reading-time">
                    {new Date(reading.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              )}

              {!reading && stream.status() === 'connected' && (
                <div class="no-data">Waiting for data...</div>
              )}

              <div class="sensor-stats">
                <small>
                  {stream.data().length} readings received
                </small>
              </div>

              <div class="sensor-controls">
                <button
                  onClick={() => stream.connect()}
                  disabled={stream.status() === 'connected'}
                >
                  Connect
                </button>
                <button
                  onClick={() => stream.disconnect()}
                  disabled={stream.status() === 'disconnected'}
                >
                  Disconnect
                </button>
                <button onClick={() => stream.clear()}>
                  Clear
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
});

/**
 * Notification Center - Global notifications
 */
const NotificationCenter = defineComponent<{ userId: string }>((props) => {
  const showNotifications = signal(true);

  // Subscribe to user notifications
  const { data: notifications, error, status } = useStream<
    NotificationService,
    'subscribe',
    Notification
  >(
    NotificationService,
    'subscribe',
    [props.userId],
    {
      bufferSize: 10,
      reconnect: true,
      filter: (notification) => {
        // Filter out old notifications (older than 5 minutes)
        const age = Date.now() - new Date(notification.timestamp).getTime();
        return age < 5 * 60 * 1000;
      },
      onData: (notification) => {
        // Show browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(notification.title, {
            body: notification.message,
            icon: '/notification-icon.png',
          });
        }
      },
    }
  );

  const unreadCount = computed(() => notifications().length);

  return () => (
    <div class="notification-center">
      <div class="notification-header">
        <h3>
          Notifications
          {unreadCount() > 0 && (
            <span class="badge">{unreadCount()}</span>
          )}
        </h3>
        <button onClick={() => showNotifications.set(!showNotifications())}>
          {showNotifications() ? 'Hide' : 'Show'}
        </button>
      </div>

      {status() !== 'connected' && (
        <div class="warning">
          Not connected to notification service
        </div>
      )}

      {error() && (
        <div class="error">Error: {error()!.message}</div>
      )}

      {showNotifications() && (
        <div class="notification-list">
          {notifications().length === 0 && (
            <div class="empty">No new notifications</div>
          )}

          {notifications().map(notif => (
            <div key={notif.id} class={`notification ${notif.type}`}>
              <div class="notification-icon">
                {notif.type === 'success' && '✅'}
                {notif.type === 'info' && 'ℹ️'}
                {notif.type === 'warning' && '⚠️'}
                {notif.type === 'error' && '❌'}
              </div>
              <div class="notification-content">
                <strong>{notif.title}</strong>
                <p>{notif.message}</p>
                <small>
                  {new Date(notif.timestamp).toLocaleTimeString()}
                </small>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * Main App - Combines all streaming components
 */
const StreamingApp = defineComponent(() => {
  return () => (
    <div class="streaming-app">
      <header>
        <h1>Aether-Netron Streaming Example</h1>
        <p>Real-time data with WebSocket subscriptions</p>
      </header>

      <div class="app-layout">
        <aside class="sidebar">
          <NotificationCenter userId="user-123" />
        </aside>

        <main class="main-content">
          <section>
            <PriceTicker symbols={['BTC/USD', 'ETH/USD', 'SOL/USD']} />
          </section>

          <section>
            <ChatRoom roomId="general" userId="user-123" />
          </section>

          <section>
            <SensorDashboard sensorIds={['T001', 'T002', 'H001']} />
          </section>
        </main>
      </div>
    </div>
  );
});

// ============================================================================
// MODULE CONFIGURATION
// ============================================================================

@Module({
  imports: [
    NetronModule.forRoot({
      backends: {
        main: 'wss://api.example.com',
        chat: 'wss://chat.example.com',
        iot: 'wss://iot.example.com',
      },
      default: 'main',
      cache: {
        maxEntries: 1000,
        defaultMaxAge: 60000,
      },
    }),
  ],
  providers: [
    PriceFeedService,
    ChatService,
    SensorService,
    NotificationService,
  ],
  bootstrap: StreamingApp,
})
export class AppModule {}

// ============================================================================
// BOOTSTRAP
// ============================================================================

export async function startApp() {
  const { container, component } = bootstrapModule(AppModule);
  console.log('Streaming app started!');
  return { container, component };
}

if (typeof window !== 'undefined') {
  startApp().catch(console.error);
}

/**
 * KEY FEATURES DEMONSTRATED:
 *
 * 1. ✅ useStream Hook
 *    - Real-time WebSocket subscriptions
 *    - Automatic reconnection
 *    - Buffer management
 *    - Status tracking
 *
 * 2. ✅ useMultiStream Hook
 *    - Multiple concurrent streams
 *    - Independent connection management
 *    - Parallel data processing
 *
 * 3. ✅ useBroadcast Hook
 *    - Send data to multiple subscribers
 *    - Async broadcasting
 *    - Error handling
 *
 * 4. ✅ Advanced Stream Options
 *    - Throttling (rate limiting)
 *    - Filtering (client-side)
 *    - Buffer size limiting
 *    - Auto-reconnection with backoff
 *    - Callbacks (onData, onConnect, etc.)
 *
 * 5. ✅ Reactive Integration
 *    - Stream data is reactive signals
 *    - Computed values work seamlessly
 *    - Auto-cleanup on unmount
 *
 * STREAMING PATTERNS:
 *
 * 1. Price Ticker - Single stream, throttled updates
 * 2. Chat Room - Bidirectional communication
 * 3. Sensor Dashboard - Multiple parallel streams
 * 4. Notification Center - Filtered stream with browser notifications
 *
 * COMPARISON:
 *
 * ❌ Manual WebSocket Management:
 * - 100+ lines of boilerplate per stream
 * - Manual reconnection logic
 * - Manual buffer management
 * - No reactive integration
 * - Error-prone state management
 *
 * ✅ useStream Hook:
 * - 10 lines per stream
 * - Auto-reconnection
 * - Built-in buffer management
 * - Full reactive integration
 * - Type-safe subscriptions
 *
 * RESULT: 90% less code + better reliability
 */
