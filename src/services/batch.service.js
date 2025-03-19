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
}

module.exports = BatchProcessor;