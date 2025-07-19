import Redis from 'ioredis';

// Generic async key-value store interface compatible with Telegraf session middleware
export interface KeyValueStore<V = any> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
}

// --------------------- In-memory store (dev / long-polling) ---------------------
export class MemoryStore<V = any> implements KeyValueStore<V> {
  private readonly data = new Map<string, V>();

  async get(key: string): Promise<V | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: V): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }
}

// --------------------- Redis-backed store (prod / webhook) ---------------------
export class RedisStore<V = any> implements KeyValueStore<V> {
  private readonly redis: Redis;
  private readonly ttlSeconds: number;

  constructor(redisUrl: string, ttlSeconds = 60 * 60 * 24) { // default TTL 24h
    this.redis = new Redis(redisUrl, {
      // Lazy connect only when first command is issued – saves cold-start time
      lazyConnect: true,
      maxRetriesPerRequest: 1,
    });
    this.ttlSeconds = ttlSeconds;
  }

  private async ensureConnected() {
    if (this.redis.status === 'end' || this.redis.status === 'close') {
      await this.redis.connect();
    }
  }

  async get(key: string): Promise<V | undefined> {
    await this.ensureConnected();
    const json = await this.redis.get(key);
    if (!json) return undefined;
    try {
      return JSON.parse(json) as V;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: V): Promise<void> {
    await this.ensureConnected();
    await this.redis.set(key, JSON.stringify(value), 'EX', this.ttlSeconds);
  }

  async delete(key: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.del(key);
  }
}

// --------------------- Factory ---------------------
export function createSessionStore<V = any>(): KeyValueStore<V> {
  const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL;
  if (redisUrl) {
    return new RedisStore<V>(redisUrl);
  }
  return new MemoryStore<V>();
} 