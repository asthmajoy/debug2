// src/utils/blockchainDataCache.js

/**
 * Cache utility for blockchain data to reduce RPC requests
 * and improve performance
 */
class BlockchainDataCache {
  constructor(defaultTtlMs = 30000) { // Default 30 second cache lifetime
    this.cache = new Map();
    this.timestamps = new Map();
    this.ttls = new Map(); // TTL per item
    this.defaultTtlMs = defaultTtlMs;
    
    // Special constants
    this.VOTE_DATA_TTL = 60000; // 1 minute for regular vote data
    this.EXPIRED_VOTE_DATA_TTL = 3600000; // 1 hour for expired proposal vote data
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
    const ttl = this.ttls.get(key) || this.defaultTtlMs;
    const now = Date.now();
    
    if (now - timestamp > ttl) {
      // Check if it's expired vote data we want to preserve
      if (this.isExpiredProposalVoteData(key)) {
        // For expired proposals, don't expire the cache entry
        // Just update the timestamp to keep it fresh
        this.timestamps.set(key, now);
        console.log(`Preserving expired proposal vote data for: ${key}`);
        return this.cache.get(key);
      }
      
      // Standard expiration - remove from cache and return null
      this.cache.delete(key);
      this.timestamps.delete(key);
      this.ttls.delete(key);
      return null;
    }
    
    // Return the cached value
    return this.cache.get(key);
  }

  /**
   * Set an item in the cache
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} ttlSeconds - TTL in seconds (optional, uses default if not provided)
   */
  set(key, value, ttlSeconds = null) {
    this.cache.set(key, value);
    this.timestamps.set(key, Date.now());
    
    // Calculate TTL in milliseconds
    let ttlMs = this.defaultTtlMs;
    
    if (ttlSeconds !== null) {
      // If specific TTL provided, convert to milliseconds
      ttlMs = ttlSeconds * 1000;
    } else if (this.isVoteDataKey(key)) {
      // Use vote data TTL for vote-related keys
      ttlMs = this.VOTE_DATA_TTL;
      
      // Check if this is for an expired proposal
      if (this.isExpiredProposalVoteData(key, value)) {
        ttlMs = this.EXPIRED_VOTE_DATA_TTL;
        console.log(`Setting long TTL for expired proposal vote data: ${key}`);
      }
    }
    
    this.ttls.set(key, ttlMs);
  }

  /**
   * Remove an item from the cache
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
    this.timestamps.delete(key);
    this.ttls.delete(key);
  }

  /**
   * Clear the entire cache
   */
  clear() {
    // Option to preserve expired proposal data when clearing
    const preserveExpiredProposalData = true;
    
    if (preserveExpiredProposalData) {
      // Store the expired proposal data keys
      const expiredDataKeys = [];
      const expiredDataValues = [];
      
      // Find all cached vote data for expired proposals
      for (const [key, value] of this.cache.entries()) {
        if (this.isExpiredProposalVoteData(key, value)) {
          expiredDataKeys.push(key);
          expiredDataValues.push(value);
        }
      }
      
      // Clear everything
      this.cache.clear();
      this.timestamps.clear();
      this.ttls.clear();
      
      // Restore expired proposal data
      const now = Date.now();
      for (let i = 0; i < expiredDataKeys.length; i++) {
        const key = expiredDataKeys[i];
        const value = expiredDataValues[i];
        
        this.cache.set(key, value);
        this.timestamps.set(key, now);
        this.ttls.set(key, this.EXPIRED_VOTE_DATA_TTL);
      }
      
      console.log(`Cache cleared, preserved ${expiredDataKeys.length} expired proposal vote entries`);
    } else {
      // Simply clear everything
      this.cache.clear();
      this.timestamps.clear();
      this.ttls.clear();
    }
  }

  /**
   * Check if a key is related to vote data
   * @param {string} key - Cache key
   * @returns {boolean} - True if the key is for vote data
   */
  isVoteDataKey(key) {
    return key.includes('votes-') || 
           key.includes('votingPower-') || 
           key.includes('dashboard-votes-') ||
           key.includes('hasVoted-');
  }

  /**
   * Check if a key/value represents vote data for an expired proposal
   * @param {string} key - Cache key
   * @param {any} value - Cache value (optional)
   * @returns {boolean} - True if it's expired proposal vote data
   */
  isExpiredProposalVoteData(key, value = null) {
    // First check the key pattern
    const isVoteKey = this.isVoteDataKey(key);
    if (!isVoteKey) return false;
    
    // If value is provided, check if it contains data showing user votes
    if (value) {
      // Check if it has totalVoters > 0 or user-provided data
      const hasTotalVoters = value.totalVoters && value.totalVoters > 0;
      
      // Check if it has vote percentages suggesting a completed vote
      const hasVotePercentages = 
        (value.yesPercentage === 100 || value.noPercentage === 100 || value.abstainPercentage === 100) &&
        value.totalVotingPower > 0;
        
      return hasTotalVoters || hasVotePercentages;
    }
    
    // If no value provided, just go by the key
    return isVoteKey;
  }

  /**
   * Ensure vote data exists for a specific proposal
   * Can be used to handle expired proposals
   * @param {string} proposalId - The proposal ID 
   * @param {Object} voteData - Vote data to set if none exists
   * @returns {boolean} - True if data was added, false if it already existed
   */
  ensureVoteData(proposalId, voteData) {
    const key = `dashboard-votes-${proposalId}`;
    
    // Check if we already have this data
    if (this.get(key) !== null) {
      return false; // Already exists
    }
    
    // Set the vote data with appropriate TTL
    this.set(key, voteData);
    
    return true; // Data was added
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
      
      // Determine appropriate TTL based on key
      const isVoteData = this.isVoteDataKey(cacheKey);
      const ttlMs = isVoteData ? this.VOTE_DATA_TTL / 1000 : null;
      
      this.set(cacheKey, result, ttlMs);
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