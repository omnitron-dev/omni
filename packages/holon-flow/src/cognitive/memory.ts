/**
 * Memory Systems - Short-term, long-term, and episodic memory
 */

/**
 * Memory options
 */
export interface MemoryOptions {
  maxSize?: number;
  ttl?: number; // Time to live in milliseconds
  onEvict?: (key: string, value: any) => void;
}

/**
 * Memory entry
 */
interface MemoryEntry<V> {
  value: V;
  timestamp: number;
  accessCount: number;
  lastAccess: number;
}

/**
 * Short-term memory with LRU eviction
 */
export class Memory<K = string, V = any> {
  private cache: Map<K, MemoryEntry<V>> = new Map();
  private readonly maxSize: number;
  private readonly ttl: number | undefined;
  private readonly onEvict?: (key: K, value: V) => void;

  constructor(options: MemoryOptions = {}) {
    this.maxSize = options.maxSize ?? 100;
    this.ttl = options.ttl;
    this.onEvict = options.onEvict as any;
  }

  /**
   * Set a value in memory
   */
  set(key: K, value: V): void {
    // Check if we need to evict
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }

    const entry: MemoryEntry<V> = {
      value,
      timestamp: Date.now(),
      accessCount: 0,
      lastAccess: Date.now(),
    };

    this.cache.set(key, entry);
  }

  /**
   * Get a value from memory
   */
  get(key: K): V | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;

    // Check TTL
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return undefined;
    }

    // Update access stats
    entry.accessCount++;
    entry.lastAccess = Date.now();

    return entry.value;
  }

  /**
   * Check if key exists
   */
  has(key: K): boolean {
    if (!this.cache.has(key)) return false;

    // Check TTL
    const entry = this.cache.get(key)!;
    if (this.ttl && Date.now() - entry.timestamp > this.ttl) {
      this.cache.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Delete a value
   */
  delete(key: K): boolean {
    return this.cache.delete(key);
  }

  /**
   * Clear all memory
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get all keys
   */
  keys(): K[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Get size
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * Private: Evict least recently used entry
   */
  private evictLRU(): void {
    let oldestKey: K | undefined;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccess < oldestTime) {
        oldestTime = entry.lastAccess;
        oldestKey = key;
      }
    }

    if (oldestKey !== undefined) {
      const entry = this.cache.get(oldestKey);
      if (entry && this.onEvict) {
        this.onEvict(oldestKey, entry.value);
      }
      this.cache.delete(oldestKey);
    }
  }
}

/**
 * Episode in episodic memory
 */
export interface Episode {
  input: any;
  output: any;
  context: Record<string, any>;
  timestamp: number;
  duration?: number;
  success?: boolean;
}

/**
 * Episodic memory options
 */
export interface EpisodicMemoryOptions {
  maxEpisodes?: number;
  indexByTime?: boolean;
  indexBySuccess?: boolean;
}

/**
 * Episodic memory for storing execution history
 */
export class EpisodicMemory {
  private episodes: Episode[] = [];
  private readonly maxEpisodes: number;
  private readonly indexByTime: boolean;
  private readonly indexBySuccess: boolean;

  constructor(options: EpisodicMemoryOptions = {}) {
    this.maxEpisodes = options.maxEpisodes ?? 1000;
    this.indexByTime = options.indexByTime ?? true;
    this.indexBySuccess = options.indexBySuccess ?? false;
  }

  /**
   * Store an episode
   */
  store(episode: Episode): void {
    this.episodes.push(episode);

    // Evict oldest if needed
    if (this.episodes.length > this.maxEpisodes) {
      this.episodes.shift();
    }
  }

  /**
   * Get recent episodes
   */
  getRecent(count: number): Episode[] {
    return this.episodes.slice(-count);
  }

  /**
   * Get episodes in time range
   */
  getInRange(start: number, end: number): Episode[] {
    return this.episodes.filter((e) => e.timestamp >= start && e.timestamp <= end);
  }

  /**
   * Find similar episodes
   */
  findSimilar(target: Episode, maxResults = 10): Episode[] {
    const similarities = this.episodes.map((episode) => ({
      episode,
      similarity: this.calculateSimilarity(episode, target),
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, maxResults).map((s) => s.episode);
  }

  /**
   * Get successful episodes
   */
  getSuccessful(): Episode[] {
    return this.episodes.filter((e) => e.success === true);
  }

  /**
   * Get failed episodes
   */
  getFailed(): Episode[] {
    return this.episodes.filter((e) => e.success === false);
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    successful: number;
    failed: number;
    averageDuration: number;
  } {
    const successful = this.episodes.filter((e) => e.success === true).length;
    const failed = this.episodes.filter((e) => e.success === false).length;
    const durations = this.episodes.filter((e) => e.duration !== undefined).map((e) => e.duration!);
    const averageDuration = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;

    return {
      total: this.episodes.length,
      successful,
      failed,
      averageDuration,
    };
  }

  /**
   * Clear all episodes
   */
  clear(): void {
    this.episodes = [];
  }

  /**
   * Get size
   */
  size(): number {
    return this.episodes.length;
  }

  /**
   * Private: Calculate similarity between episodes
   */
  private calculateSimilarity(e1: Episode, e2: Episode): number {
    // Simple similarity based on input/output structure
    let score = 0;

    // Compare inputs
    if (typeof e1.input === typeof e2.input) {
      score += 0.5;
    }

    // Compare outputs
    if (typeof e1.output === typeof e2.output) {
      score += 0.5;
    }

    return score;
  }
}

/**
 * Associative memory for similarity-based retrieval
 */
export class AssociativeMemory<T> {
  private items: Array<{ value: T; embedding: number[]; metadata: Record<string, any> }> = [];
  private readonly maxSize: number;

  constructor(options: { maxSize?: number } = {}) {
    this.maxSize = options.maxSize ?? 1000;
  }

  /**
   * Store an item with its embedding
   */
  store(value: T, embedding: number[], metadata: Record<string, any> = {}): void {
    this.items.push({ value, embedding, metadata });

    // Evict if needed
    if (this.items.length > this.maxSize) {
      this.items.shift();
    }
  }

  /**
   * Retrieve similar items
   */
  retrieve(queryEmbedding: number[], topK = 5): T[] {
    const similarities = this.items.map((item) => ({
      item: item.value,
      similarity: this.cosineSimilarity(queryEmbedding, item.embedding),
    }));

    similarities.sort((a, b) => b.similarity - a.similarity);

    return similarities.slice(0, topK).map((s) => s.item);
  }

  /**
   * Find items with metadata matching criteria
   */
  find(criteria: (metadata: Record<string, any>) => boolean): T[] {
    return this.items.filter((item) => criteria(item.metadata)).map((item) => item.value);
  }

  /**
   * Clear all items
   */
  clear(): void {
    this.items = [];
  }

  /**
   * Get size
   */
  size(): number {
    return this.items.length;
  }

  /**
   * Private: Calculate cosine similarity
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i]! * b[i]!;
      normA += a[i]! * a[i]!;
      normB += b[i]! * b[i]!;
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    return denominator === 0 ? 0 : dotProduct / denominator;
  }
}

/**
 * Working memory for reasoning
 */
export class WorkingMemory {
  private items: Map<string, any> = new Map();
  private readonly capacity: number;

  constructor(capacity = 7) {
    // Miller's law: 7 ± 2 items
    this.capacity = capacity;
  }

  /**
   * Add item to working memory
   */
  add(key: string, value: any): void {
    if (this.items.size >= this.capacity && !this.items.has(key)) {
      // Evict first item (FIFO)
      const firstKey = this.items.keys().next().value;
      if (firstKey !== undefined) {
        this.items.delete(firstKey);
      }
    }

    this.items.set(key, value);
  }

  /**
   * Get item from working memory
   */
  get(key: string): any {
    return this.items.get(key);
  }

  /**
   * Check if key exists
   */
  has(key: string): boolean {
    return this.items.has(key);
  }

  /**
   * Get all items
   */
  getAll(): Array<[string, any]> {
    return Array.from(this.items.entries());
  }

  /**
   * Clear working memory
   */
  clear(): void {
    this.items.clear();
  }

  /**
   * Get size
   */
  size(): number {
    return this.items.size;
  }

  /**
   * Check if at capacity
   */
  isFull(): boolean {
    return this.items.size >= this.capacity;
  }
}
