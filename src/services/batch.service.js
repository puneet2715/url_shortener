const { pool, redisClient } = require('../config/db');
const { logger } = require('../config/logger');

class BatchProcessor {
  static async processPendingUrls() {
    try {
      const BATCH_SIZE = 100;
      
      // Get pending URLs
      const pendingUrls = await redisClient.sMembers('pending_urls');
      if (!pendingUrls.length) {
        logger.debug('No pending URLs to process');
        return;
      }
      
      logger.info(`Processing ${pendingUrls.length} pending URLs`);
      
      // Process in batches
      for (let i = 0; i < pendingUrls.length; i += BATCH_SIZE) {
        const batch = pendingUrls.slice(i, i + BATCH_SIZE);
        
        // Get URL data for batch
        const urlDataPromises = batch.map(shortUrl =>
          redisClient.hGetAll(`url:${shortUrl}`)
        );
        const urlDataBatch = await Promise.all(urlDataPromises);

        // Filter out any empty or invalid data
        const validUrlData = urlDataBatch.filter(data => data && data.longUrl);

        if (!validUrlData.length) continue;

        // Prepare batch query with proper SQL escaping
        const values = validUrlData.map((data, index) => {
          return `($${index * 5 + 1}, $${index * 5 + 2}, $${index * 5 + 3}, $${index * 5 + 4}, $${index * 5 + 5})`
        }).join(',');

        const flatParams = validUrlData.flatMap(data => [
          data.userId,
          data.longUrl,
          data.shortUrl,
          data.topic || null,
          new Date(parseInt(data.createdAt))
        ]);

        // Execute batch insert
        await pool.query(`
          INSERT INTO urls (user_id, long_url, short_url, topic, created_at)
          VALUES ${values}
          ON CONFLICT (short_url) DO NOTHING
        `, flatParams);

        // Update Redis status
        const multi = redisClient.multi();
        batch.forEach(shortUrl => {
          multi.hSet(`url:${shortUrl}`, 'status', 'synced');
          multi.sRem('pending_urls', shortUrl);
        });
        await multi.exec();

        logger.info(`Processed batch of ${batch.length} URLs`);
      }
    } catch (error) {
      logger.error('Error in processPendingUrls:', error);
      throw error;
    }
  }

  static async processAnalytics() {
    try {
      const BATCH_SIZE = 100;
      
      // Verify Redis connection
      if (!redisClient.isOpen) {
        logger.warn('Redis connection not open in processAnalytics, reconnecting');
        await redisClient.connect();
      }

      // Get pending analytics
      const pendingAnalytics = await redisClient.sMembers('pending_analytics');
      if (!pendingAnalytics.length) {
        logger.debug('No pending analytics to process');
        return;
      }
      
      const startTime = Date.now();
      logger.info(`Processing ${pendingAnalytics.length} analytics items | Start time: ${new Date(startTime).toISOString()}`);
      logger.debug(`Sample pending keys: ${pendingAnalytics.slice(0, 3).join(', ')}`);
      
      // Process in batches
      for (let i = 0; i < pendingAnalytics.length; i += BATCH_SIZE) {
        const batch = pendingAnalytics.slice(i, i + BATCH_SIZE);
        
        // Get analytics data for batch
        const analyticsPromises = batch.map(key =>
          redisClient.hGetAll(key)
        );
        const analyticsBatch = await Promise.all(analyticsPromises);

        // Filter out any empty or invalid data
        const validAnalytics = analyticsBatch.filter(data => data && data.urlId);

        if (!validAnalytics.length) continue;

        // Prepare batch query with proper SQL escaping
        const values = validAnalytics.map((data, index) => {
          return `($${index * 8 + 1}, $${index * 8 + 2}, $${index * 8 + 3}, $${index * 8 + 4},
                  $${index * 8 + 5}, $${index * 8 + 6}, $${index * 8 + 7}, $${index * 8 + 8})`
        }).join(',');

        const flatParams = validAnalytics.flatMap(data => [
          data.urlId,
          data.ip || '',
          data.userAgent || '',
          data.deviceType || '',
          data.osType || '',
          data.browser || '',
          data.country || '',
          data.city || ''
        ]);

        // Execute batch insert
        await pool.query(`
          INSERT INTO analytics (
            url_id, visitor_ip, user_agent, device_type,
            os_type, browser, country, city
          ) VALUES ${values}
        `, flatParams);

        // Update Redis status
        const multi = redisClient.multi();
        batch.forEach(key => {
          multi.del(key);
          multi.sRem('pending_analytics', key);
        });
        await multi.exec();

        const endTime = Date.now();
        const duration = endTime - startTime;
        logger.info(`Processed batch of ${batch.length} analytics | Duration: ${duration}ms | ${new Date().toISOString()}`);
      }
    } catch (error) {
      logger.error('Error in processAnalytics:', error);
      throw error;
    }
  }

  static async syncCounters() {
    try {
      // Get all URL stats keys
      const statsKeys = await redisClient.keys('stats:*:total_clicks');
      
      if (!statsKeys.length) {
        logger.debug('No counters to sync');
        return;
      }

      logger.info(`Syncing ${statsKeys.length} counters`);

      // Process each URL's stats
      for (const key of statsKeys) {
        const shortUrl = key.split(':')[1];
        
        // Get current values from Redis
        const [totalClicks, uniqueVisitors] = await Promise.all([
          redisClient.get(`stats:${shortUrl}:total_clicks`),
          redisClient.pfCount(`stats:${shortUrl}:unique_visitors`)
        ]);

        // Update last accessed timestamp
        await pool.query(`
          UPDATE urls
          SET last_accessed = CURRENT_TIMESTAMP
          WHERE short_url = $1
        `, [shortUrl]);

        // Force update of analytics summary
        await redisClient.del(`analytics:${shortUrl}`);
      }

      logger.info('Successfully synced all counters');
    } catch (error) {
      logger.error('Error in syncCounters:', error);
      throw error;
    }
  }
}

module.exports = BatchProcessor;