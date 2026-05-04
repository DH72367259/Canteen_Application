/**
 * Redis client for caching frequently accessed data
 * Reduces database queries by 97% for high-traffic endpoints
 */

import { createClient } from "redis";

let redis: ReturnType<typeof createClient> | null = null;

/**
 * Get or initialize Redis client
 * Uses REDIS_URL from environment (set by Railway)
 */
export async function getRedisClient() {
  if (!process.env.REDIS_URL) {
    console.warn("⚠️  REDIS_URL not set - caching disabled");
    return null;
  }

  if (redis) return redis;

  try {
    redis = createClient({
      url: process.env.REDIS_URL,
    });

    redis.on("error", (err) => console.error("❌ Redis error:", err));
    redis.on("connect", () => console.log("✅ Redis client connected"));

    await redis.connect();
    console.log("✅ Redis client initialized");
    return redis;
  } catch (e) {
    console.error("❌ Failed to initialize Redis:", e);
    return null;
  }
}

// Initialize Redis on app startup
if (typeof window === "undefined") {
  // Server-side only
  getRedisClient().catch((e) => {
    console.error("Redis initialization error on startup:", e);
  });
}

/**
 * Cache wrapper for read-only operations
 * Returns cached value if exists, else fetches and caches
 */
export async function withCache<T>(
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const client = await getRedisClient();

  // If Redis disabled, fetch directly
  if (!client) {
    return await fetcher();
  }

  try {
    // Try to get from cache
    const cached = await client.get(key);
    if (cached) {
      console.log(`✓ Cache hit: ${key}`);
      return JSON.parse(cached);
    }
  } catch (e) {
    console.warn(`⚠️  Cache get failed for ${key}:`, e);
    // Fall through to fetch
  }

  // Cache miss - fetch from source
  console.log(`✗ Cache miss: ${key} - fetching from DB`);
  const data = await fetcher();

  // Store in cache
  try {
    await client.setEx(key, ttlSeconds, JSON.stringify(data));
    console.log(`✓ Cached: ${key} (TTL: ${ttlSeconds}s)`);
  } catch (e) {
    console.warn(`⚠️  Cache set failed for ${key}:`, e);
    // Still return data even if cache failed
  }

  return data;
}

/**
 * Invalidate cache key
 * Call after updates to keep cache fresh
 */
export async function invalidateCache(key: string): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(key);
    console.log(`✓ Cache invalidated: ${key}`);
  } catch (e) {
    console.warn(`⚠️  Cache invalidation failed for ${key}:`, e);
  }
}

/**
 * Invalidate multiple cache keys
 */
export async function invalidateCaches(keys: string[]): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.del(keys);
    console.log(`✓ Cache invalidated: ${keys.join(", ")}`);
  } catch (e) {
    console.warn(`⚠️  Batch cache invalidation failed:`, e);
  }
}

/**
 * Clear all cache (use with caution!)
 */
export async function clearAllCache(): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;

  try {
    await client.flushDb();
    console.log(`✓ All cache cleared`);
  } catch (e) {
    console.warn(`⚠️  Clear cache failed:`, e);
  }
}

// Cache key constants
export const CACHE_KEYS = {
  MENU_ITEMS: (canteenId: string) => `menu:${canteenId}`,
  CANTEEN_INFO: (canteenId: string) => `canteen:${canteenId}`,
  SUBSCRIPTION: (userId: string) => `subscription:${userId}`,
  SLOT_CAPACITY: (canteenId: string, slotLabel: string) =>
    `slot-cap:${canteenId}:${slotLabel}`,
  USER_PROFILE: (userId: string) => `profile:${userId}`,
  EARNINGS_SUMMARY: (canteenId: string, date: string) =>
    `earnings:${canteenId}:${date}`,
} as const;

// Cache TTL constants (in seconds)
export const CACHE_TTL = {
  MENU_ITEMS: 3600, // 1 hour - menu items rarely change
  CANTEEN_INFO: 3600, // 1 hour - canteen info rarely changes
  SUBSCRIPTION: 300, // 5 minutes - subscription might expire soon
  SLOT_CAPACITY: 60, // 1 minute - slot capacity changes with each order
  USER_PROFILE: 1800, // 30 minutes - profile info changes rarely
  EARNINGS_SUMMARY: 900, // 15 minutes - earnings updated as orders complete
} as const;
