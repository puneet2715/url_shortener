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
      
      // Get pending analytics from PostgreSQL
      const pendingResult = await pool.query(`
        SELECT id, url_id, visitor_ip, user_agent,
               device_type, os_type, browser, country, city
        FROM pending_analytics
        ORDER BY created_at
        LIMIT $1
      `, [BATCH_SIZE * 10]); // Get slightly more to account for invalid data

      if (!pendingResult.rows.length) {
        logger.debug('No pending analytics to process');
        return;
      }
      
      const startTime = Date.now();
      logger.info(`Processing ${pendingResult.rows.length} analytics items | Start time: ${new Date(startTime).toISOString()}`);
      
      // Process in batches
      for (let i = 0; i < pendingResult.rows.length; i += BATCH_SIZE) {
        const batch = pendingResult.rows.slice(i, i + BATCH_SIZE);
        
        // Filter out any empty or invalid data
        const validAnalytics = batch.filter(data => data && data.url_id);

        if (!validAnalytics.length) continue;

        // Prepare batch query with proper SQL escaping
        const values = validAnalytics.map((data, index) => {
          return `($${index * 8 + 1}, $${index * 8 + 2}, $${index * 8 + 3}, $${index * 8 + 4},
                  $${index * 8 + 5}, $${index * 8 + 6}, $${index * 8 + 7}, $${index * 8 + 8})`
        }).join(',');

        const flatParams = validAnalytics.flatMap(data => [
          data.url_id,
          data.visitor_ip || '',
          data.user_agent || '',
          data.device_type || '',
          data.os_type || '',
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

        // Delete processed items
        const ids = validAnalytics.map(data => data.id);
        await pool.query(`
          DELETE FROM pending_analytics
          WHERE id = ANY($1)
        `, [ids]);

        const endTime = Date.now();
        const duration = endTime - startTime;
        logger.info(`Processed batch of ${validAnalytics.length} analytics | Duration: ${duration}ms | ${new Date().toISOString()}`);
      }
    } catch (error) {
      logger.error('Error in processAnalytics:', error);
      throw error;
    }
  }

  static async syncCounters() {
    try {
      // Get URLs with recent activity from PostgreSQL
      const urlsResult = await pool.query(`
        SELECT short_url,
               COUNT(*) as total_clicks,
               COUNT(DISTINCT visitor_ip) as unique_visitors
        FROM analytics
        WHERE visited_at > CURRENT_TIMESTAMP - INTERVAL '1 hour'
        GROUP BY short_url
      `);

      if (!urlsResult.rows.length) {
        logger.debug('No counters to sync');
        return;
      }

      // Update counters in PostgreSQL
      for (const row of urlsResult.rows) {
        await pool.query(`
          UPDATE urls
          SET
            total_clicks = total_clicks + $1,
            unique_visitors = unique_visitors + $2,
            last_accessed = CURRENT_TIMESTAMP
          WHERE short_url = $3
        `, [parseInt(row.total_clicks), parseInt(row.unique_visitors), row.short_url]);
      }
    } catch (error) {
      logger.error('Error in syncCounters:', error);
      throw error;
    }
  }
}

module.exports = BatchProcessor;