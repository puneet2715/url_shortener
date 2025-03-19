import { CacheService } from './cache.service';
const { redisClient } = require('../config/db');
class AnalyticsService {
  static async trackVisit(shortUrl, visitorData) {
    // Store analytics in Redis first
    const analyticsKey = `analytics:${shortUrl}:${Date.now()}`;
    await redisClient.hSet(analyticsKey, {
      ...visitorData,
      timestamp: Date.now()
    });
    
    // Add to processing queue
    await redisClient.sAdd('pending_analytics', analyticsKey);
    
    // Increment counters atomically
    const multi = redisClient.multi();
    multi.incr(`stats:${shortUrl}:total_clicks`);
    multi.pfAdd(`stats:${shortUrl}:unique_visitors`, visitorData.ip);
    await multi.exec();
  }

  static async getUrlAnalytics(shortUrl) {
    // Use cache service for analytics data
    return CacheService.get(`analytics:${shortUrl}`, async () => {
      // Fetch from Redis first
      const [totalClicks, uniqueVisitors] = await Promise.all([
        redisClient.get(`stats:${shortUrl}:total_clicks`),
        redisClient.pfCount(`stats:${shortUrl}:unique_visitors`)
      ]);

      // Fall back to PostgreSQL for historical data
      if (!totalClicks) {
        return this.getAnalyticsFromPostgres(shortUrl);
      }

      return {
        totalClicks: parseInt(totalClicks),
        uniqueVisitors
      };
    }, { memoryTTL: 60 }); // Short TTL for analytics
  }
} 