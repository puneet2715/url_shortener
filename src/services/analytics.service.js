import { CacheService } from './cache.service';
const { pool, redisClient } = require('../config/db');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const { logger } = require('../config/logger');

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
      const ua = UAParser(req.headers['user-agent']);
      const ip = req.ip;
      const geo = geoip.lookup(ip);

      // Create visitor data for Redis tracking
      const visitorData = {
        ip,
        userAgent: req.headers['user-agent'],
        deviceType: ua.device.type || 'desktop',
        osType: ua.os.name,
        browser: ua.browser.name,
        country: geo?.country,
        city: geo?.city,
        urlId
      };

      // Track in Redis
      await this.trackVisit(shortUrl, visitorData);

      // Also track in PostgreSQL for historical data
      await pool.query(
        `INSERT INTO analytics (
          url_id, visitor_ip, user_agent, device_type, os_type, browser, country, city
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          urlId,
          ip,
          req.headers['user-agent'],
          ua.device.type || 'desktop',
          ua.os.name,
          ua.browser.name,
          geo?.country,
          geo?.city
        ]
      );

      // Update last accessed timestamp
      await pool.query(
        'UPDATE urls SET last_accessed = CURRENT_TIMESTAMP WHERE id = $1',
        [urlId]
      );
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
        totalClicks: parseInt(totalClicks || '0'),
        uniqueVisitors
      };
    }, { memoryTTL: 60 }); // Short TTL for analytics
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

    return {
      totalClicks: parseInt(totalClicksResult.rows[0].total),
      uniqueUsers: parseInt(uniqueUsersResult.rows[0].total),
      clicksByDate: clicksByDateResult.rows,
      urls: urlStats
    };
  }

  static async getOverallAnalytics(userId) {
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