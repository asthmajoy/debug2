// src/utils/blockchainDataCache.js

/**
 * Cache utility for blockchain data to reduce RPC requests
 * and improve performance
 */
class BlockchainDataCache {
  constructor(ttlMs = 30000) { // Default 30 second cache lifetime
    this.cache = new Map();
    this.timestamps = new Map();
    this.ttlMs = ttlMs;
  }

  /**
   * Get an item from the cache
   * @param {string} key - Cache key
   * @returns {any|null} - Cached value or null if not found/expired
   */
  get(key) {
    // If key doesn't exist, return null
    if (!this.cache.has(key)) {
      return null;
    }
    
    // Check if the cached value has expired
    const timestamp = this.timestamps.get(key);
    const now = Date.now();
    
    if (now - timestamp > this.ttlMs) {
      // Expired - remove from cache and return null
      this.cache.delete(key);
      this.timestamps.delete(key);
      return null;
    }
    
    // Return the cached value
    return this.cache.get(key);
  }

  /**
   * Set an item in the cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   */
  set(key, value) {
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
  }

  /**
   * Remove an item from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
  }

  /**
   * Clear the entire cache
   */
  clear() {
    this.cache.clear();
    this.timestamps.clear();
  }

  /**
   * Get a cached function result or compute and cache
   * @param {string} cacheKey - Unique key for this function call
   * @param {Function} fn - Async function to execute if cache miss
   * @param {Array} args - Arguments to pass to the function
   * @returns {Promise<any>} - Cached or computed result
   */
  async getOrCompute(cacheKey, fn, ...args) {
    // Check cache first
    const cachedValue = this.get(cacheKey);
    if (cachedValue !== null) {
      console.log(`Cache hit for ${cacheKey}`);
      return cachedValue;
    }
    
    // Cache miss - compute the value
    console.log(`Cache miss for ${cacheKey}, executing function`);
    try {
      const result = await fn(...args);
      this.set(cacheKey, result);
      return result;
    } catch (error) {
      console.error(`Error computing value for ${cacheKey}:`, error);
      throw error;
    }
  }
}

// Create singleton instance
const blockchainDataCache = new BlockchainDataCache();

export default blockchainDataCache;