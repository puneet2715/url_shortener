const { CacheService } = require('./cache.service');
const { pool, redisClient } = require('../config/db');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const { logger } = require('../config/logger');

class AnalyticsService {
  static async trackVisit(shortUrl, visitorData) {
    try {
      // Sanitize visitorData to avoid Redis type errors
      const sanitizedData = {};
      
      // Process each key in visitorData, ensuring no undefined or null values
      Object.entries(visitorData).forEach(([key, value]) => {
        // Skip null/undefined values
        if (value === null || value === undefined) {
          return;
        }
        
        // Convert objects or arrays to strings
        if (typeof value === 'object') {
          sanitizedData[key] = JSON.stringify(value);
        } else {
          // Convert other types to strings if needed
          sanitizedData[key] = String(value);
        }
      });
      
      // Store analytics in Redis first
      const analyticsKey = `analytics:${shortUrl}:${Date.now()}`;
      await redisClient.hSet(analyticsKey, {
        ...sanitizedData,
        timestamp: String(Date.now())
      });
      
      // Add to processing queue
      await redisClient.sAdd('pending_analytics', analyticsKey);
      
      // Increment counters atomically
      const multi = redisClient.multi();
      multi.incr(`stats:${shortUrl}:total_clicks`);
      if (sanitizedData.ip) {
        multi.pfAdd(`stats:${shortUrl}:unique_visitors`, sanitizedData.ip);
      }
      await multi.exec();
      
      return true;
    } catch (error) {
      logger.error('Error in trackVisit function:', {
        error: error.message || error,
        shortUrl,
        visitorDataKeys: Object.keys(visitorData || {})
      });
      
      // Don't throw the error to prevent impact on the user experience
      // Just log it and return false to indicate failure
      return false;
    }
  }

  static async trackVisitFromRequest(shortUrl, req) {
    try {
      const urlResult = await pool.query('SELECT id FROM urls WHERE short_url = $1', [shortUrl]);
      if (!urlResult.rows.length) {
        throw { 
          type: 'validation', 
          message: 'Short URL not found',
          details: 'Cannot track visit for non-existent URL'
        };
      }

      const urlId = urlResult.rows[0].id;
      const ua = UAParser(req.headers['user-agent'] || '');
      const ip = req.ip || '0.0.0.0';
      const geo = geoip.lookup(ip);

      // Create visitor data for Redis tracking with default values to prevent nulls
      const visitorData = {
        ip,
        userAgent: req.headers['user-agent'] || '',
        deviceType: ua?.device?.type || '',
        osType: ua?.os?.name || '',
        browser: ua?.browser?.name || '',
        country: geo?.country || '',
        city: geo?.city || '',
        urlId: String(urlId)
      };

      // Track in Redis
      const redisTrackingSuccess = await this.trackVisit(shortUrl, visitorData);

      // Also track in PostgreSQL for historical data
      await pool.query(
        `INSERT INTO analytics (
          url_id, visitor_ip, user_agent, device_type, os_type, browser, country, city
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          urlId,
          ip,
          req.headers['user-agent'] || '',
          visitorData.deviceType,
          visitorData.osType,
          visitorData.browser,
          visitorData.country,
          visitorData.city
        ]
      );

      // Update last accessed timestamp
      await pool.query(
        'UPDATE urls SET last_accessed = CURRENT_TIMESTAMP WHERE id = $1',
        [urlId]
      );
      
      // Log warning if Redis tracking failed but PostgreSQL succeeded
      if (!redisTrackingSuccess) {
        logger.warn('Redis tracking failed, but PostgreSQL tracking succeeded', { shortUrl });
      }
    } catch (error) {
      logger.error('Error tracking visit:', {
        error,
        shortUrl
      });
      throw error;
    }
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
        totalClicks: parseInt(totalClicks || '0', 10),
        uniqueVisitors: parseInt(uniqueVisitors || '0', 10)
      };
    }, { memoryTTL: 60, skipMemory: true }); // Short TTL for analytics
  }

  static async getAnalyticsFromPostgres(shortUrl) {
    const urlResult = await pool.query('SELECT id FROM urls WHERE short_url = $1', [shortUrl]);
    if (!urlResult.rows.length) {
      throw { 
        type: 'validation', 
        message: 'URL not found',
        details: 'Cannot retrieve analytics for non-existent URL'
      };
    }

    const urlId = urlResult.rows[0].id;

    // Get total clicks
    const totalClicksResult = await pool.query(
      'SELECT COUNT(*) as total FROM analytics WHERE url_id = $1',
      [urlId]
    );

    // Get unique users (by IP)
    const uniqueUsersResult = await pool.query(
      'SELECT COUNT(DISTINCT visitor_ip) as total FROM analytics WHERE url_id = $1',
      [urlId]
    );

    // Get clicks by date (last 7 days)
    const clicksByDateResult = await pool.query(
      `SELECT 
        DATE(visited_at) as date,
        COUNT(*) as clicks
      FROM analytics 
      WHERE url_id = $1 
        AND visited_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(visited_at)
      ORDER BY date DESC`,
      [urlId]
    );

    // Get OS statistics
    const osStatsResult = await pool.query(
      `SELECT 
        os_type as "osName",
        COUNT(*) as "uniqueClicks",
        COUNT(DISTINCT visitor_ip) as "uniqueUsers"
      FROM analytics 
      WHERE url_id = $1 
      GROUP BY os_type`,
      [urlId]
    );

    // Get device type statistics
    const deviceStatsResult = await pool.query(
      `SELECT 
        device_type as "deviceName",
        COUNT(*) as "uniqueClicks",
        COUNT(DISTINCT visitor_ip) as "uniqueUsers"
      FROM analytics 
      WHERE url_id = $1 
      GROUP BY device_type`,
      [urlId]
    );

    return {
      totalClicks: parseInt(totalClicksResult.rows[0].total),
      uniqueUsers: parseInt(uniqueUsersResult.rows[0].total),
      clicksByDate: clicksByDateResult.rows,
      osType: osStatsResult.rows,
      deviceType: deviceStatsResult.rows
    };
  }

  static async getTopicAnalytics(topic) {
    if (!topic) {
      throw { 
        type: 'validation', 
        message: 'Topic is required',
        details: 'Please provide a valid topic to retrieve analytics'
      };
    }

    // Use cache service for topic analytics data
    return CacheService.get(`topic_analytics:${topic}`, async () => {
      // Try to get data from Redis first
      const topicCacheKey = `topic:${topic}:urls`;
      const cachedUrlIds = await redisClient.sMembers(topicCacheKey);
      
      if (cachedUrlIds && cachedUrlIds.length > 0) {
        // Check if we have aggregated stats in Redis
        const [totalClicks, uniqueUsers] = await Promise.all([
          redisClient.get(`topic:${topic}:total_clicks`),
          redisClient.get(`topic:${topic}:unique_users`)
        ]);
        
        if (totalClicks && uniqueUsers) {
          // Get URL-specific stats from Redis
          const urlsResult = await pool.query(
            `SELECT id, short_url as "shortUrl"
            FROM urls 
            WHERE id = ANY($1)`,
            [cachedUrlIds]
          );
          
          const urlStatsPromises = urlsResult.rows.map(async (url) => {
            const [urlClicks, urlUniqueUsers] = await Promise.all([
              redisClient.get(`stats:${url.shortUrl}:total_clicks`),
              redisClient.pfCount(`stats:${url.shortUrl}:unique_visitors`)
            ]);
            
            if (urlClicks) {
              return {
                shortUrl: url.shortUrl,
                totalClicks: parseInt(urlClicks, 10),
                uniqueUsers: parseInt(urlUniqueUsers || '0', 10)
              };
            }
            
            // Fall back to postgres for this URL
            const stats = await pool.query(
              `SELECT 
                COUNT(*) as "totalClicks",
                COUNT(DISTINCT visitor_ip) as "uniqueUsers"
              FROM analytics 
              WHERE url_id = $1`,
              [url.id]
            );
            
            return {
                shortUrl: url.shortUrl,
                totalClicks: parseInt(stats.rows[0].totalClicks, 10),
                uniqueUsers: parseInt(stats.rows[0].uniqueUsers, 10)
            };
          });
          
          const urlStats = await Promise.all(urlStatsPromises);
          
          // Get clicks by date from Redis if available
          const clicksByDateKey = `topic:${topic}:clicks_by_date`;
          const cachedClicksByDate = await redisClient.get(clicksByDateKey);
          
          if (cachedClicksByDate) {
            try {
              // Parse the JSON string and convert date strings back to Date objects
              const clicksByDate = JSON.parse(cachedClicksByDate).map(entry => ({
                date: entry.date, // Keep as string as PostgreSQL returns it as string too
                clicks: parseInt(entry.clicks, 10)
              }));
            
              return {
                totalClicks: parseInt(totalClicks, 10),
                uniqueUsers: parseInt(uniqueUsers, 10),
                clicksByDate,
                urls: urlStats
              };
            } catch (error) {
              logger.error('Error parsing Redis cache for topic analytics:', { 
                error: error.message, 
                topic 
              });
              // Fall back to PostgreSQL on parsing error
              return this.getTopicAnalyticsFromPostgres(topic);
            }
          }
        }
      }
      
      // Fall back to PostgreSQL for complete data
      return this.getTopicAnalyticsFromPostgres(topic);
    }, { memoryTTL: 300, skipMemory: true }); // Cache topic analytics for 5 minutes
  }
  
  static async getTopicAnalyticsFromPostgres(topic) {
    // Get all URLs for the topic
    const urlsResult = await pool.query(
      `SELECT id, short_url as "shortUrl"
      FROM urls 
      WHERE topic = $1`,
      [topic]
    );

    const urlIds = urlsResult.rows.map(row => row.id);
    
    if (!urlIds.length) {
      return {
        totalClicks: 0,
        uniqueUsers: 0,
        clicksByDate: [],
        urls: []
      };
    }

    // Get total clicks for the topic
    const totalClicksResult = await pool.query(
      'SELECT COUNT(*) as total FROM analytics WHERE url_id = ANY($1)',
      [urlIds]
    );

    // Get unique users for the topic
    const uniqueUsersResult = await pool.query(
      'SELECT COUNT(DISTINCT visitor_ip) as total FROM analytics WHERE url_id = ANY($1)',
      [urlIds]
    );

    // Get clicks by date for the topic
    const clicksByDateResult = await pool.query(
      `SELECT 
        DATE(visited_at) as date,
        COUNT(*) as clicks
      FROM analytics 
      WHERE url_id = ANY($1)
        AND visited_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(visited_at)
      ORDER BY date DESC`,
      [urlIds]
    );

    // Get per-URL statistics
    const urlStatsPromises = urlsResult.rows.map(async (url) => {
      const stats = await pool.query(
        `SELECT 
          COUNT(*) as "totalClicks",
          COUNT(DISTINCT visitor_ip) as "uniqueUsers"
        FROM analytics 
        WHERE url_id = $1`,
        [url.id]
      );
      return {
        shortUrl: url.shortUrl,
        totalClicks: parseInt(stats.rows[0].totalClicks),
        uniqueUsers: parseInt(stats.rows[0].uniqueUsers)
      };
    });

    const urlStats = await Promise.all(urlStatsPromises);
    
    // Cache the results in Redis for future requests
    const topicCacheKey = `topic:${topic}:urls`;
    const multi = redisClient.multi();
    
    // Cache URL IDs for this topic
    multi.del(topicCacheKey);
    if (urlIds.length) {
      multi.sAdd(topicCacheKey, urlIds);
    }
    
    // Cache aggregated statistics
    multi.set(`topic:${topic}:total_clicks`, totalClicksResult.rows[0].total);
    multi.set(`topic:${topic}:unique_users`, uniqueUsersResult.rows[0].total);
    
    // Cache clicks by date as JSON
    multi.set(`topic:${topic}:clicks_by_date`, JSON.stringify(clicksByDateResult.rows));
    
    // Set expiration for these keys
    multi.expire(topicCacheKey, 3600); // 1 hour
    multi.expire(`topic:${topic}:total_clicks`, 3600);
    multi.expire(`topic:${topic}:unique_users`, 3600);
    multi.expire(`topic:${topic}:clicks_by_date`, 3600);
    
    await multi.exec();

    return {
      totalClicks: parseInt(totalClicksResult.rows[0].total),
      uniqueUsers: parseInt(uniqueUsersResult.rows[0].total),
      clicksByDate: clicksByDateResult.rows,
      urls: urlStats
    };
  }

  static async getOverallAnalytics(userId) {
    // Use cache service for user analytics data
    return CacheService.get(`user_analytics:${userId}`, async () => {
      // Try to get data from Redis first
      const userCacheKey = `user:${userId}:urls`;
      const cachedUrlIds = await redisClient.sMembers(userCacheKey);
      
      if (cachedUrlIds && cachedUrlIds.length > 0) {
        // Check if we have aggregated stats in Redis
        const [totalClicks, uniqueUsers, totalUrls] = await Promise.all([
          redisClient.get(`user:${userId}:total_clicks`),
          redisClient.get(`user:${userId}:unique_users`),
          redisClient.get(`user:${userId}:total_urls`)
        ]);
        
        if (totalClicks && uniqueUsers && totalUrls) {
          // Get OS and device stats from Redis if available
          const [osTypeData, deviceTypeData, clicksByDateData] = await Promise.all([
            redisClient.get(`user:${userId}:os_stats`),
            redisClient.get(`user:${userId}:device_stats`),
            redisClient.get(`user:${userId}:clicks_by_date`)
          ]);
          
          if (osTypeData && deviceTypeData && clicksByDateData) {
            try {
              // Parse JSON data and ensure proper type conversion
              const clicksByDate = JSON.parse(clicksByDateData).map(entry => ({
                date: entry.date, // Keep as string as PostgreSQL returns it as string too
                clicks: parseInt(entry.clicks, 10)
              }));
              
              const osType = JSON.parse(osTypeData).map(entry => ({
                osName: entry.osName,
                uniqueClicks: parseInt(entry.uniqueClicks, 10),
                uniqueUsers: parseInt(entry.uniqueUsers, 10)
              }));
              
              const deviceType = JSON.parse(deviceTypeData).map(entry => ({
                deviceName: entry.deviceName,
                uniqueClicks: parseInt(entry.uniqueClicks, 10),
                uniqueUsers: parseInt(entry.uniqueUsers, 10)
              }));
            
              return {
                totalUrls: parseInt(totalUrls, 10),
                totalClicks: parseInt(totalClicks, 10),
                uniqueUsers: parseInt(uniqueUsers, 10),
                clicksByDate,
                osType,
                deviceType
              };
            } catch (error) {
              logger.error('Error parsing Redis cache for user analytics:', { 
                error: error.message, 
                userId 
              });
              // Fall back to PostgreSQL on parsing error
              return this.getOverallAnalyticsFromPostgres(userId);
            }
          }
        }
      }
      
      // Fall back to PostgreSQL for complete data
      return this.getOverallAnalyticsFromPostgres(userId);
    }, { memoryTTL: 300, skipMemory: true }); // Cache user analytics for 5 minutes
  }
  
  static async getOverallAnalyticsFromPostgres(userId) {
    // Get all URLs for the user
    const urlsResult = await pool.query(
      'SELECT id FROM urls WHERE user_id = $1',
      [userId]
    );

    const urlIds = urlsResult.rows.map(row => row.id);
    
    if (!urlIds.length) {
      return {
        totalUrls: 0,
        totalClicks: 0,
        uniqueUsers: 0,
        clicksByDate: [],
        osType: [],
        deviceType: []
      };
    }

    // Get total clicks
    const totalClicksResult = await pool.query(
      'SELECT COUNT(*) as total FROM analytics WHERE url_id = ANY($1)',
      [urlIds]
    );

    // Get unique users
    const uniqueUsersResult = await pool.query(
      'SELECT COUNT(DISTINCT visitor_ip) as total FROM analytics WHERE url_id = ANY($1)',
      [urlIds]
    );

    // Get clicks by date
    const clicksByDateResult = await pool.query(
      `SELECT 
        DATE(visited_at) as date,
        COUNT(*) as clicks
      FROM analytics 
      WHERE url_id = ANY($1)
        AND visited_at >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY DATE(visited_at)
      ORDER BY date DESC`,
      [urlIds]
    );

    // Get OS statistics
    const osStatsResult = await pool.query(
      `SELECT 
        os_type as "osName",
        COUNT(*) as "uniqueClicks",
        COUNT(DISTINCT visitor_ip) as "uniqueUsers"
      FROM analytics 
      WHERE url_id = ANY($1)
      GROUP BY os_type`,
      [urlIds]
    );

    // Get device type statistics
    const deviceStatsResult = await pool.query(
      `SELECT 
        device_type as "deviceName",
        COUNT(*) as "uniqueClicks",
        COUNT(DISTINCT visitor_ip) as "uniqueUsers"
      FROM analytics 
      WHERE url_id = ANY($1)
      GROUP BY device_type`,
      [urlIds]
    );
    
    try {
      // Safe Redis values - ensure all values are of proper type
      const totalClicks = totalClicksResult.rows[0]?.total || '0';
      const uniqueUsers = uniqueUsersResult.rows[0]?.total || '0';
      const clicksByDateJson = clicksByDateResult.rows?.length 
        ? JSON.stringify(clicksByDateResult.rows) 
        : JSON.stringify([]);
      const osTypeJson = osStatsResult.rows?.length 
        ? JSON.stringify(osStatsResult.rows) 
        : JSON.stringify([]);
      const deviceTypeJson = deviceStatsResult.rows?.length 
        ? JSON.stringify(deviceStatsResult.rows) 
        : JSON.stringify([]);
      
      // Cache the results in Redis for future requests
      const userCacheKey = `user:${userId}:urls`;
      const multi = redisClient.multi();
      
      // Cache URL IDs for this user - convert each ID to string
      multi.del(userCacheKey);
      if (urlIds.length) {
        // Convert each ID to string before adding to Redis set
        const stringUrlIds = urlIds.map(id => String(id));
        multi.sAdd(userCacheKey, stringUrlIds);
      }
      
      // Cache aggregated statistics - ensure all values are strings
      multi.set(`user:${userId}:total_urls`, String(urlIds.length));
      multi.set(`user:${userId}:total_clicks`, String(totalClicks));
      multi.set(`user:${userId}:unique_users`, String(uniqueUsers));
      
      // Cache JSON data
      multi.set(`user:${userId}:clicks_by_date`, clicksByDateJson);
      multi.set(`user:${userId}:os_stats`, osTypeJson);
      multi.set(`user:${userId}:device_stats`, deviceTypeJson);
      
      // Set expiration for these keys
      multi.expire(userCacheKey, 3600); // 1 hour
      multi.expire(`user:${userId}:total_urls`, 3600);
      multi.expire(`user:${userId}:total_clicks`, 3600);
      multi.expire(`user:${userId}:unique_users`, 3600);
      multi.expire(`user:${userId}:clicks_by_date`, 3600);
      multi.expire(`user:${userId}:os_stats`, 3600);
      multi.expire(`user:${userId}:device_stats`, 3600);
      
      await multi.exec();
    } catch (error) {
      // Log Redis error but continue to return data from PostgreSQL
      logger.error('Error caching analytics in Redis:', {
        error: error.message || error,
        userId
      });
    }

    return {
      totalUrls: urlIds.length,
      totalClicks: parseInt(totalClicksResult.rows[0].total),
      uniqueUsers: parseInt(uniqueUsersResult.rows[0].total),
      clicksByDate: clicksByDateResult.rows,
      osType: osStatsResult.rows,
      deviceType: deviceStatsResult.rows
    };
  }
}

module.exports = AnalyticsService; 