/**
 * Mock Redis implementation for testing when real Redis is not available
 * This provides a minimal in-memory implementation for basic Redis operations
 */
export class MockRedis {
  private data: Map<string, any> = new Map();
  private expires: Map<string, number> = new Map();
  private pubsubCallbacks: Map<string, Function[]> = new Map();
  public connected = true;

  async connect(): Promise<void> {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  async ping(): Promise<string> {
    return 'PONG';
  }

  async flushall(): Promise<string> {
    this.data.clear();
    this.expires.clear();
    return 'OK';
  }

  async flushdb(): Promise<string> {
    return this.flushall();
  }

  async set(key: string, value: string): Promise<string> {
    this.data.set(key, value);
    return 'OK';
  }

  async get(key: string): Promise<string | null> {
    this.checkExpired(key);
    return this.data.get(key) || null;
  }

  async del(...keys: string[]): Promise<number> {
    let deleted = 0;
    for (const key of keys) {
      if (this.data.delete(key)) {
        deleted++;
      }
      this.expires.delete(key);
    }
    return deleted;
  }

  async exists(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      this.checkExpired(key);
      if (this.data.has(key)) {
        count++;
      }
    }
    return count;
  }

  async expire(key: string, seconds: number): Promise<number> {
    if (this.data.has(key)) {
      this.expires.set(key, Date.now() + seconds * 1000);
      return 1;
    }
    return 0;
  }

  async ttl(key: string): Promise<number> {
    this.checkExpired(key);
    if (!this.data.has(key)) {
      return -2;
    }
    const expireTime = this.expires.get(key);
    if (!expireTime) {
      return -1;
    }
    return Math.ceil((expireTime - Date.now()) / 1000);
  }

  async hset(key: string, field: string, value: string): Promise<number> {
    let hash = this.data.get(key);
    if (!hash || typeof hash !== 'object') {
      hash = {};
      this.data.set(key, hash);
    }
    const isNew = !(field in hash);
    hash[field] = value;
    return isNew ? 1 : 0;
  }

  async hget(key: string, field: string): Promise<string | null> {
    this.checkExpired(key);
    const hash = this.data.get(key);
    if (hash && typeof hash === 'object' && field in hash) {
      return hash[field];
    }
    return null;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.checkExpired(key);
    const hash = this.data.get(key);
    if (hash && typeof hash === 'object') {
      return { ...hash };
    }
    return {};
  }

  async sadd(key: string, ...members: string[]): Promise<number> {
    let set = this.data.get(key);
    if (!set || !(set instanceof Set)) {
      set = new Set();
      this.data.set(key, set);
    }
    let added = 0;
    for (const member of members) {
      if (!set.has(member)) {
        set.add(member);
        added++;
      }
    }
    return added;
  }

  async srem(key: string, ...members: string[]): Promise<number> {
    const set = this.data.get(key);
    if (!set || !(set instanceof Set)) {
      return 0;
    }
    let removed = 0;
    for (const member of members) {
      if (set.delete(member)) {
        removed++;
      }
    }
    return removed;
  }

  async sismember(key: string, member: string): Promise<number> {
    this.checkExpired(key);
    const set = this.data.get(key);
    if (set && set instanceof Set) {
      return set.has(member) ? 1 : 0;
    }
    return 0;
  }

  async smembers(key: string): Promise<string[]> {
    this.checkExpired(key);
    const set = this.data.get(key);
    if (set && set instanceof Set) {
      return Array.from(set);
    }
    return [];
  }

  async publish(channel: string, message: string): Promise<number> {
    const callbacks = this.pubsubCallbacks.get(channel) || [];
    callbacks.forEach(cb => cb(message));
    return callbacks.length;
  }

  subscribe(channel: string, callback: Function): void {
    if (!this.pubsubCallbacks.has(channel)) {
      this.pubsubCallbacks.set(channel, []);
    }
    this.pubsubCallbacks.get(channel)!.push(callback);
  }

  unsubscribe(channel: string): void {
    this.pubsubCallbacks.delete(channel);
  }

  private checkExpired(key: string): void {
    const expireTime = this.expires.get(key);
    if (expireTime && Date.now() > expireTime) {
      this.data.delete(key);
      this.expires.delete(key);
    }
  }

  // Stream operations (minimal implementation)
  async xadd(key: string, id: string, ...fields: string[]): Promise<string> {
    let stream = this.data.get(key);
    if (!stream || !Array.isArray(stream)) {
      stream = [];
      this.data.set(key, stream);
    }
    const entry = { id: id === '*' ? Date.now().toString() : id, fields };
    stream.push(entry);
    return entry.id;
  }

  async xread(...args: any[]): Promise<any[]> {
    // Simplified implementation
    return [];
  }

  async xreadgroup(...args: any[]): Promise<any[]> {
    // Simplified implementation
    return [];
  }

  async xgroup(...args: any[]): Promise<string> {
    return 'OK';
  }

  async xack(...args: any[]): Promise<number> {
    return 1;
  }

  // Multi/Pipeline support
  multi(): this {
    return this;
  }

  pipeline(): this {
    return this;
  }

  async exec(): Promise<any[]> {
    return [];
  }
}