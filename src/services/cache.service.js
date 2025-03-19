const NodeCache = require('node-cache');
const memoryCache = new NodeCache({ stdTTL: 300 }); // 5 minutes default TTL
const { redisClient } = require('../config/db');

class CacheService {
  static async get(key, fetchCallback, options = {}) {
    const { 
      memoryTTL = 300,  // 5 minutes
      redisTTL = 86400, // 24 hours
      skipMemory = false
    } = options;

    // Check memory cache
    if (!skipMemory) {
      const memoryData = memoryCache.get(key);
      if (memoryData) return memoryData;
    }

    // Check Redis cache
    const redisData = await redisClient.get(key);
    if (redisData) {
      // Populate memory cache
      if (!skipMemory) {
        memoryCache.set(key, redisData, memoryTTL);
      }
      return redisData;
    }

    // Fetch fresh data
    const data = await fetchCallback();

    // Update both caches
    const multi = redisClient.multi();
    multi.set(key, JSON.stringify(data), { EX: redisTTL });
    if (!skipMemory) {
      memoryCache.set(key, data, memoryTTL);
    }
    await multi.exec();

    return data;
  }
} 

module.exports = { CacheService }