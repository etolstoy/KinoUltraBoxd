import Redis from 'ioredis';

// Generic async key-value store interface compatible with Telegraf session middleware
export interface KeyValueStore<V = any> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  acquire(key: string, token: string, ttlSeconds: number): Promise<boolean>;
  release(key: string, token: string): Promise<void>;
}

// --------------------- In-memory store (dev / long-polling) ---------------------
export class MemoryStore<V = any> implements KeyValueStore<V> {
  private readonly data = new Map<string, V>();
  private readonly locks = new Map<string, { token: string; until: number }>();

  async get(key: string): Promise<V | undefined> {
    return this.data.get(key);
  }

  async set(key: string, value: V): Promise<void> {
    this.data.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.data.delete(key);
  }

  async acquire(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    if ((this.locks.get(key)?.until ?? 0) > Date.now()) return false;
    this.locks.set(key, { token, until: Date.now() + ttlSeconds * 1000 });
    return true;
  }

  async release(key: string, token: string): Promise<void> {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
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

  async acquire(key: string, token: string, ttlSeconds: number): Promise<boolean> {
    await this.ensureConnected();
    return await this.redis.set(key, token, 'EX', ttlSeconds, 'NX') === 'OK';
  }

  async release(key: string, token: string): Promise<void> {
    await this.ensureConnected();
    await this.redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", 1, key, token);
  }
}

// --------------------- Factory ---------------------
export function createSessionStore<V = any>(): KeyValueStore<V> {
  const redisUrl = process.env.REDIS_URL;
  if (redisUrl) {
    return new RedisStore<V>(redisUrl);
  }
  return new MemoryStore<V>();
}
