/**
 * Mock implementation of NotificationManager for testing without Redis
 * Provides in-memory implementation of Rotif messaging patterns
 */

import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { RotifMessage, Subscription, PublishOptions, SubscribeOptions, RotifConfig } from '../../../src/rotif/types.js';

/**
 * Mock Redis client with Stream and Sorted Set support
 */
export class MockRotifRedis extends EventEmitter {
  private data = new Map<string, any>();
  private streams = new Map<string, Array<{ id: string; fields: Record<string, string> }>>();
  private sortedSets = new Map<string, Array<{ value: string; score: number }>>();
  private consumerGroups = new Map<string, { stream: string; group: string; lastId: string }>();
  private pendingMessages = new Map<string, Array<{ id: string; consumer: string; idle: number; deliveryCount: number }>>();
  private subscriptions = new Map<string, Set<(channel: string, message: string) => void>>();

  async get(key: string): Promise<string | null> {
    return this.data.get(key) ?? null;
  }

  async set(key: string, value: string, ...args: any[]): Promise<'OK' | null> {
    // Handle SET key value [EX seconds] [NX]
    let exSeconds: number | null = null;
    let nx = false;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'EX' && i + 1 < args.length) {
        exSeconds = args[i + 1];
        i++;
      } else if (args[i] === 'NX') {
        nx = true;
      }
    }

    if (nx && this.data.has(key)) {
      return null;
    }

    this.data.set(key, value);

    if (exSeconds) {
      setTimeout(() => this.data.delete(key), exSeconds * 1000);
    }

    return 'OK';
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      // Delete from regular data
      if (this.data.delete(key)) {
        deleted++;
      }
      // Also delete from streams if it's a stream
      if (this.streams.delete(key)) {
        deleted++;
      }
      // Also delete from sorted sets
      if (this.sortedSets.delete(key)) {
        deleted++;
      }
    }
    return deleted > 0 ? 1 : 0; // Return 1 if anything was deleted
  }

  async flushdb(): Promise<'OK'> {
    this.data.clear();
    this.streams.clear();
    this.sortedSets.clear();
    this.consumerGroups.clear();
    this.pendingMessages.clear();
    return 'OK';
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
    return Array.from(this.data.keys()).filter((key) => regex.test(key));
  }

  // Stream operations
  async xgroup(command: string, ...args: any[]): Promise<any> {
    const cmd = command.toUpperCase();

    if (cmd === 'CREATE') {
      const [stream, group, startId, ...flags] = args;
      const key = `${stream}:${group}`;

      if (this.consumerGroups.has(key)) {
        throw new Error('BUSYGROUP Consumer Group name already exists');
      }

      // MKSTREAM flag creates stream if it doesn't exist
      if (flags.includes('MKSTREAM') && !this.streams.has(stream)) {
        this.streams.set(stream, []);
      }

      this.consumerGroups.set(key, { stream, group, lastId: startId });
      this.pendingMessages.set(key, []);
      return 'OK';
    }

    return 'OK';
  }

  async xadd(stream: string, id: string, ...fieldValues: string[]): Promise<string> {
    if (!this.streams.has(stream)) {
      this.streams.set(stream, []);
    }

    const streamData = this.streams.get(stream)!;

    // Generate ID if '*'
    const messageId = id === '*' ? `${Date.now()}-${streamData.length}` : id;

    // Parse field-value pairs
    const fields: Record<string, string> = {};
    for (let i = 0; i < fieldValues.length; i += 2) {
      fields[fieldValues[i]!] = fieldValues[i + 1]!;
    }

    streamData.push({ id: messageId, fields });
    return messageId;
  }

  async xreadgroup(
    groupArg: string,
    group: string,
    consumer: string,
    ...args: any[]
  ): Promise<[string, [string, string[]][]][] | null> {
    // Parse arguments: COUNT n BLOCK ms STREAMS stream1 stream2 ... id1 id2 ...
    let count = 10;
    let block = 0;
    let streamsIdx = -1;

    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'COUNT') {
        count = args[i + 1];
        i++;
      } else if (args[i] === 'BLOCK') {
        block = args[i + 1];
        i++;
      } else if (args[i] === 'STREAMS') {
        streamsIdx = i + 1;
        break;
      }
    }

    if (streamsIdx === -1) {
      throw new Error('STREAMS keyword required');
    }

    const streamCount = Math.floor((args.length - streamsIdx) / 2);
    const streams = args.slice(streamsIdx, streamsIdx + streamCount);
    const ids = args.slice(streamsIdx + streamCount);

    const result: [string, [string, string[]][]][] = [];

    for (let i = 0; i < streams.length; i++) {
      const stream = streams[i]!;
      const startId = ids[i];
      const key = `${stream}:${group}`;

      if (!this.consumerGroups.has(key)) {
        throw new Error('NOGROUP No such consumer group');
      }

      const streamData = this.streams.get(stream) || [];
      const messages: [string, string[]][] = [];

      // '>' means undelivered messages
      if (startId === '>') {
        const groupInfo = this.consumerGroups.get(key)!;
        const lastIdProcessed = groupInfo.lastId;

        for (const msg of streamData) {
          if (this.compareStreamIds(msg.id, lastIdProcessed) > 0) {
            const fields: string[] = [];
            for (const [k, v] of Object.entries(msg.fields)) {
              fields.push(k, v);
            }
            messages.push([msg.id, fields]);

            if (messages.length >= count) {
              break;
            }
          }
        }

        // Update last delivered ID
        if (messages.length > 0) {
          groupInfo.lastId = messages[messages.length - 1]![0];
        }
      }

      if (messages.length > 0) {
        result.push([stream, messages]);
      }
    }

    // Simulate blocking
    if (block > 0 && result.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(block, 100)));
      return null;
    }

    return result.length > 0 ? result : null;
  }

  async xack(stream: string, group: string, ...ids: string[]): Promise<number> {
    const key = `${stream}:${group}`;
    const pending = this.pendingMessages.get(key) || [];

    let acked = 0;
    for (const id of ids) {
      const index = pending.findIndex((p) => p.id === id);
      if (index !== -1) {
        pending.splice(index, 1);
        acked++;
      }
    }

    return acked;
  }

  async xpending(
    stream: string,
    group: string,
    ...args: any[]
  ): Promise<any> {
    // xpending stream group IDLE minIdleTime start end count
    const key = `${stream}:${group}`;
    const pending = this.pendingMessages.get(key) || [];

    // Simple form without arguments returns [count, minId, maxId, consumers]
    if (args.length === 0) {
      const count = pending.length;
      if (count === 0) {
        return [0, null, null, null];
      }
      const minId = pending[0]!.id;
      const maxId = pending[pending.length - 1]!.id;
      return [count, minId, maxId, null];
    }

    // Extended form with IDLE filter
    if (args[0] === 'IDLE') {
      const minIdle = args[1] || 0;
      return pending
        .filter((p) => p.idle >= minIdle)
        .map((p) => [p.id, p.consumer, p.idle, p.deliveryCount]);
    }

    return pending.map((p) => [p.id, p.consumer, p.idle, p.deliveryCount]);
  }

  async xclaim(
    stream: string,
    group: string,
    consumer: string,
    minIdleTime: number,
    ...ids: string[]
  ): Promise<[string, string[]][]> {
    const streamData = this.streams.get(stream) || [];
    const result: [string, string[]][] = [];

    for (const id of ids) {
      const msg = streamData.find((m) => m.id === id);
      if (msg) {
        const fields: string[] = [];
        for (const [k, v] of Object.entries(msg.fields)) {
          fields.push(k, v);
        }
        result.push([id, fields]);
      }
    }

    return result;
  }

  async xrange(
    stream: string,
    start: string,
    end: string,
    ...args: any[]
  ): Promise<[string, string[]][]> {
    const streamData = this.streams.get(stream) || [];
    let count = streamData.length;

    // Parse COUNT argument
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'COUNT') {
        count = args[i + 1];
        i++;
      }
    }

    const result: [string, string[]][] = [];

    for (const msg of streamData) {
      // Simple range check
      const matchStart = start === '-' || this.compareStreamIds(msg.id, start) >= 0;
      const matchEnd = end === '+' || this.compareStreamIds(msg.id, end) <= 0;

      if (matchStart && matchEnd) {
        const fields: string[] = [];
        for (const [k, v] of Object.entries(msg.fields)) {
          fields.push(k, v);
        }
        result.push([msg.id, fields]);

        if (result.length >= count) {
          break;
        }
      }
    }

    return result;
  }

  async xrevrange(
    stream: string,
    end: string,
    start: string,
    ...args: any[]
  ): Promise<[string, string[]][]> {
    // xrevrange parameters: end comes first, start comes second
    // xrange expects start first, then end
    // So we swap them: xrange(start, end)
    // Then reverse the result to get newest first

    // First get all messages in range (without COUNT limit)
    const argsWithoutCount: any[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'COUNT') {
        // Skip COUNT and its value
        i++;
      } else {
        argsWithoutCount.push(args[i]);
      }
    }

    // Get all messages in range
    const allMessages = await this.xrange(stream, start, end, ...argsWithoutCount);

    // Reverse to get newest first
    const reversed = allMessages.reverse();

    // Apply COUNT limit if specified
    let count = reversed.length;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === 'COUNT') {
        count = args[i + 1];
        break;
      }
    }

    return reversed.slice(0, count);
  }

  async xlen(stream: string): Promise<number> {
    const streamData = this.streams.get(stream) || [];
    return streamData.length;
  }

  async xdel(stream: string, ...ids: string[]): Promise<number> {
    const streamData = this.streams.get(stream);
    if (!streamData) return 0;

    let deleted = 0;
    for (const id of ids) {
      const index = streamData.findIndex((m) => m.id === id);
      if (index !== -1) {
        streamData.splice(index, 1);
        deleted++;
      }
    }

    return deleted;
  }

  async xinfo(command: string, stream: string): Promise<any> {
    const cmd = command.toUpperCase();

    if (cmd === 'GROUPS') {
      // Return consumer groups for the stream
      const groups: any[] = [];
      for (const [key, value] of this.consumerGroups) {
        if (value.stream === stream) {
          groups.push([
            'name', value.group,
            'consumers', 1,
            'pending', 0,
            'last-delivered-id', value.lastId
          ]);
        }
      }
      return groups;
    }

    // For other XINFO commands, return empty/default
    return [];
  }

  // Sorted set operations
  async zincrby(key: string, increment: number, member: string): Promise<string> {
    if (!this.sortedSets.has(key)) {
      this.sortedSets.set(key, []);
    }

    const set = this.sortedSets.get(key)!;
    const existing = set.find((item) => item.value === member);

    if (existing) {
      existing.score += increment;
      return String(existing.score);
    } else {
      set.push({ value: member, score: increment });
      return String(increment);
    }
  }

  async zrangebyscore(key: string, min: string | number, max: string | number): Promise<string[]> {
    const set = this.sortedSets.get(key) || [];
    const minScore = min === '-inf' ? -Infinity : Number(min);
    const maxScore = max === '+inf' ? Infinity : Number(max);

    return set
      .filter((item) => item.score >= minScore && item.score <= maxScore)
      .sort((a, b) => a.score - b.score)
      .map((item) => item.value);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    const set = this.sortedSets.get(key) || [];
    const sorted = set.sort((a, b) => a.score - b.score);

    const startIdx = start < 0 ? sorted.length + start : start;
    const stopIdx = stop < 0 ? sorted.length + stop + 1 : stop + 1;

    return sorted.slice(startIdx, stopIdx).map((item) => item.value);
  }

  // Pub/Sub operations
  async publish(channel: string, message: string): Promise<number> {
    const subscribers = this.subscriptions.get(channel) || new Set();
    for (const callback of subscribers) {
      setTimeout(() => callback(channel, message), 0);
    }
    return subscribers.size;
  }

  async subscribe(channel: string): Promise<void> {
    // Just mark as subscribed - actual handler is set via 'on'
    if (!this.subscriptions.has(channel)) {
      this.subscriptions.set(channel, new Set());
    }
    this.emit('subscribe', channel, this.subscriptions.get(channel)!.size);
  }

  // Lua script support
  async evalsha(sha: string, numKeys: number, ...args: any[]): Promise<any> {
    // Mock Lua script execution based on script patterns
    // This is a simplified version that handles common Rotif patterns

    // For 'publish-message' script (publishes to stream or schedules)
    if (args.length >= 13) {
      const streamKey = args[0];
      const scheduledKey = args[1];
      const payload = args[2];
      const timestamp = args[3];
      const channel = args[4];
      const attempt = args[5];
      const deliveryType = args[6];
      const delayTimestamp = args[7];

      if (deliveryType === 'delayed') {
        // Add to scheduled sorted set
        if (!this.sortedSets.has(scheduledKey)) {
          this.sortedSets.set(scheduledKey, []);
        }
        const scheduled = this.sortedSets.get(scheduledKey)!;
        const messageData = JSON.stringify({
          stream: streamKey,
          payload,
          timestamp,
          channel,
          attempt,
        });
        scheduled.push({ value: messageData, score: Number(delayTimestamp) });
        return 'SCHEDULED';
      } else {
        // Add to stream immediately
        const messageId = `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        await this.xadd(
          streamKey,
          messageId,
          'payload', payload,
          'timestamp', timestamp,
          'channel', channel,
          'attempt', attempt,
          'pattern', args[12] || channel
        );
        return messageId;
      }
    }

    // For 'ack-message' script
    if (args.length >= 3 && args[0] && typeof args[1] === 'string' && typeof args[2] === 'string') {
      const stream = args[0];
      const group = args[1];
      const id = args[2];
      return await this.xack(stream, group, id);
    }

    // For 'move-scheduled-messages' script
    if (args[0] === 'rotif:scheduled') {
      const now = Number(args[1]);
      const scheduled = this.sortedSets.get('rotif:scheduled') || [];
      let moved = 0;

      const toMove = scheduled.filter((item) => item.score <= now);

      for (const item of toMove) {
        try {
          const data = JSON.parse(item.value);
          await this.xadd(
            data.stream,
            '*',
            'payload', data.payload,
            'timestamp', data.timestamp,
            'channel', data.channel,
            'attempt', data.attempt
          );
          moved++;
        } catch (e) {
          // Ignore parse errors
        }
      }

      // Remove moved items
      const newScheduled = scheduled.filter((item) => item.score > now);
      this.sortedSets.set('rotif:scheduled', newScheduled);

      return moved;
    }

    // For 'safe-unsubscribe' script
    if (args[0] === 'rotif:patterns' && args[1]) {
      const pattern = args[1];
      const set = this.sortedSets.get('rotif:patterns') || [];
      const existing = set.find((item) => item.value === pattern);

      if (existing) {
        existing.score -= 1;
        if (existing.score <= 0) {
          const index = set.indexOf(existing);
          set.splice(index, 1);
          return 0;
        }
        return existing.score;
      }
      return 0;
    }

    // Default: return success
    return 'OK';
  }

  async script(command: string, ...args: any[]): Promise<any> {
    if (command === 'LOAD') {
      // Return fake SHA for loaded script
      return 'mock-sha-' + Math.random().toString(36).substr(2, 40);
    }
    return 'OK';
  }

  // Connection management
  async quit(): Promise<'OK'> {
    return 'OK';
  }

  disconnect(): void {
    // No-op
  }

  on(event: string, handler: (...args: any[]) => void): this {
    if (event === 'message') {
      // Register message handler for subscriptions
      for (const [channel, subscribers] of this.subscriptions) {
        subscribers.add(handler as any);
      }
    }
    return super.on(event, handler);
  }

  get status(): string {
    return 'ready';
  }

  get options(): any {
    return {
      retryStrategy: () => null,
    };
  }

  // Helper to compare stream IDs
  private compareStreamIds(id1: string, id2: string): number {
    if (id1 === '-') return -1;
    if (id1 === '+') return 1;
    if (id2 === '-') return 1;
    if (id2 === '+') return -1;
    if (id1 === '0') return id2 === '0' ? 0 : -1;

    const [time1, seq1 = '0'] = id1.split('-').map(Number);
    const [time2, seq2 = '0'] = id2.split('-').map(Number);

    if (time1 !== time2) {
      return time1! - time2!;
    }
    return seq1! - seq2!;
  }
}

/**
 * Mock NotificationManager for testing
 * Implements the same interface as NotificationManager but uses in-memory storage
 */
export class MockNotificationManager {
  public redis: MockRotifRedis;
  public config: RotifConfig;
  private subscriptions = new Map<string, Subscription>();
  private handlers = new Map<string, Array<{ pattern: string; handler: (msg: RotifMessage) => Promise<void>; subscription: Subscription }>>();
  private activePatterns = new Set<string>();
  private processingInterval?: NodeJS.Timeout;
  private active = true;

  constructor(config: RotifConfig) {
    this.config = config;
    this.redis = new MockRotifRedis();

    // Start message processing loop
    this.startProcessingLoop();
  }

  async waitUntilReady(): Promise<void> {
    // Mock is always ready
    return Promise.resolve();
  }

  async publish(channel: string, payload: any, options?: PublishOptions): Promise<string[] | string | null> {
    this.checkActive();

    const matchingPatterns = Array.from(this.activePatterns).filter((pattern) => {
      // Simple glob matching
      const regex = new RegExp('^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
      return regex.test(channel);
    });

    if (matchingPatterns.length === 0) {
      return null;
    }

    // Handle deduplication
    if (options?.exactlyOnce) {
      const dedupKey = `rotif:dedup:pub:${channel}:*:${JSON.stringify(payload)}`;
      const existing = await this.redis.get(dedupKey);
      if (existing) {
        return 'DUPLICATE';
      }
      // Set dedup key with TTL
      const ttl = options.deduplicationTTL || 3600;
      await this.redis.set(dedupKey, '1', 'EX', ttl);
    }

    const timestamp = Date.now().toString();
    const attempt = String(options?.attempt ?? 1);
    const deliveryType = options?.delayMs || options?.deliverAt ? 'delayed' : 'normal';
    const delayTimestamp = options?.deliverAt
      ? new Date(options.deliverAt).getTime().toString()
      : options?.delayMs
        ? (Date.now() + options.delayMs).toString()
        : '0';

    const results: string[] = [];

    for (const pattern of matchingPatterns) {
      const streamKey = `rotif:stream:${pattern}`;

      const result = await this.redis.evalsha(
        'mock-publish',
        2,
        streamKey,
        'rotif:scheduled',
        JSON.stringify(payload),
        timestamp,
        channel,
        attempt,
        deliveryType,
        delayTimestamp,
        '0', // maxStreamLength
        '', // minStreamId
        '', // dedupKey
        '3600', // deduplicationTTL
        randomUUID(),
        'false', // exactlyOnce
        pattern
      );

      results.push(result as string);
    }

    return results.length === 1 ? results[0]! : results;
  }

  async subscribe(
    pattern: string,
    handler: (msg: RotifMessage) => Promise<void>,
    options?: SubscribeOptions
  ): Promise<Subscription> {
    const subId = randomUUID();
    const stream = `rotif:stream:${pattern}`;
    const group = `rotif:group:${pattern}${options?.groupName ? ':' + options.groupName : ''}`;

    // Create consumer group
    try {
      await this.redis.xgroup('CREATE', stream, group, '0', 'MKSTREAM');
    } catch (err: any) {
      if (!err?.message?.includes('BUSYGROUP')) throw err;
    }

    const subscription: Subscription = {
      id: subId,
      pattern,
      group,
      options,
      handler,
      inflightCount: 0,
      isPaused: false,
      unsubscribe: async (removePattern = false) => {
        subscription.isPaused = true;
        this.subscriptions.delete(subId);

        const patternHandlers = this.handlers.get(pattern);
        if (patternHandlers) {
          const index = patternHandlers.findIndex((h) => h.subscription.id === subId);
          if (index !== -1) {
            patternHandlers.splice(index, 1);
          }

          if (patternHandlers.length === 0) {
            this.handlers.delete(pattern);
            if (removePattern) {
              this.activePatterns.delete(pattern);
            }
          }
        }
      },
      pause: () => {
        subscription.isPaused = true;
      },
      resume: () => {
        subscription.isPaused = false;
      },
      stats: () => ({
        processed: 0,
        failed: 0,
        retried: 0,
        avgProcessingTime: 0,
      }),
      statsTracker: {
        recordMessage: () => {},
        recordRetry: () => {},
        recordFailure: () => {},
        getStats: () => ({
          processed: 0,
          failed: 0,
          retried: 0,
          avgProcessingTime: 0,
        }),
      },
    };

    this.subscriptions.set(subId, subscription);

    if (!this.handlers.has(pattern)) {
      this.handlers.set(pattern, []);
    }
    this.handlers.get(pattern)!.push({ pattern, handler, subscription });

    // Add to active patterns
    await this.redis.zincrby('rotif:patterns', 1, pattern);
    this.activePatterns.add(pattern);

    return subscription;
  }

  async subscribeToDLQ(handler: (msg: RotifMessage) => Promise<void>): Promise<void> {
    // Mock DLQ subscription - just store the handler
    // In a real implementation this would subscribe to the DLQ stream
    // For mock purposes, we can skip this since DLQ is rarely used in tests
  }

  async requeueFromDLQ(count = 10): Promise<number> {
    // Mock requeue - return 0 as no messages are in DLQ in mock
    return 0;
  }

  async getDLQStats(): Promise<any> {
    return {
      totalMessages: 0,
      oldestMessage: null,
      newestMessage: null,
      messagesByChannel: {},
    };
  }

  async getDLQMessages(options?: any): Promise<any[]> {
    return [];
  }

  async cleanupDLQ(): Promise<number> {
    return 0;
  }

  async clearDLQ(): Promise<void> {
    // No-op for mock
  }

  updateDLQConfig(config: any): void {
    // No-op for mock
  }

  use(middleware: any): void {
    // No-op for mock - middleware support can be added if needed
  }

  async stopAll(): Promise<void> {
    this.active = false;

    if (this.processingInterval) {
      clearInterval(this.processingInterval);
    }

    // Unsubscribe all
    for (const sub of this.subscriptions.values()) {
      await sub.unsubscribe(false);
    }

    await this.redis.quit();
  }

  private checkActive(): void {
    if (!this.active) {
      throw new Error('NotificationManager is not active');
    }
  }

  private startProcessingLoop(): void {
    this.processingInterval = setInterval(async () => {
      if (!this.active) return;

      // Process scheduled messages
      await this.redis.evalsha('mock-move-scheduled', 1, 'rotif:scheduled', Date.now().toString(), '1000');

      // Process messages for each pattern
      for (const [pattern, patternHandlers] of this.handlers) {
        const stream = `rotif:stream:${pattern}`;

        for (const { handler, subscription } of patternHandlers) {
          if (subscription.isPaused) continue;

          const group = subscription.group;

          try {
            const entries = await this.redis.xreadgroup(
              'GROUP',
              group,
              'mock-consumer',
              'COUNT',
              10,
              'BLOCK',
              0,
              'STREAMS',
              stream,
              '>'
            );

            if (!entries) continue;

            for (const [streamName, records] of entries) {
              for (const [id, rawFields] of records) {
                const fields: Record<string, string> = {};
                for (let i = 0; i < rawFields.length; i += 2) {
                  fields[rawFields[i]!] = rawFields[i + 1]!;
                }

                const msg: RotifMessage = {
                  id,
                  channel: fields['channel'] || pattern,
                  payload: JSON.parse(fields['payload'] || '{}'),
                  timestamp: parseInt(fields['timestamp'] || '0'),
                  attempt: parseInt(fields['attempt'] || '1'),
                  ack: async () => {
                    await this.redis.xack(stream, group, id);
                  },
                };

                try {
                  await handler(msg);
                  await msg.ack();
                } catch (err) {
                  // In mock, we just ack failed messages to keep tests simple
                  await msg.ack();
                }
              }
            }
          } catch (err) {
            // Ignore errors in processing loop
          }
        }
      }
    }, 100); // Process every 100ms
  }
}
