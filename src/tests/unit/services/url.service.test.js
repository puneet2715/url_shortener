// Import Redis mock before other imports
const { mockPool, mockDatabase } = require('../../mocks/db');
const mockRedisClient = require('../../mocks/redis');
const { mockDbUser } = require('../../setup');
const UrlService = require('../../../services/url.service');

// Mock geoip-lite
jest.mock('geoip-lite', () => ({
  lookup: jest.fn().mockReturnValue({
    country: 'US',
    city: 'New York'
  })
}));

// Mock ua-parser-js
jest.mock('ua-parser-js', () => jest.fn().mockReturnValue({
  device: { type: 'desktop' },
  os: { name: 'Windows' },
  browser: { name: 'Chrome' }
}));

describe('UrlService', () => {
  beforeAll(() => {
    mockDatabase();
  });

  let mockReq;

  beforeEach(async () => {
    // Clear mock data
    mockPool.tables = {
      users: [],
      urls: [],
      visits: []
    };

    // Clear Redis cache
    mockRedisClient.clear();

    // Insert test user into database
    await mockPool.query(
      'INSERT INTO users (id, google_id, email, name, avatar) VALUES ($1, $2, $3, $4, $5)',
      [mockDbUser.id, mockDbUser.google_id, mockDbUser.email, mockDbUser.name, mockDbUser.avatar]
    );

    // Mock request object for tracking visits
    mockReq = {
      ip: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent'
      }
    };
  });

  describe('createShortUrl', () => {
    it('should create a short URL with generated alias', async () => {
      const url = await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com',
        null,
        'test-topic'
      );

      expect(url).toHaveProperty('id');
      expect(url).toHaveProperty('short_url');
      expect(url.long_url).toBe('https://example.com');
      expect(url.topic).toBe('test-topic');
      expect(url.user_id).toBe(mockDbUser.google_id);
    });

    it('should create a short URL with custom alias', async () => {
      const customAlias = 'custom-test';
      const url = await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com',
        customAlias,
        'test-topic'
      );

      expect(url.short_url).toBe(customAlias);
    });

    it('should reject duplicate custom alias', async () => {
      const customAlias = 'unique-test';
      
      // Create first URL
      await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/first',
        customAlias,
        'test-topic'
      );

      // Try to create second URL with same alias
      await expect(
        UrlService.createShortUrl(
          mockDbUser.google_id,
          'https://example.com/second',
          customAlias,
          'test-topic'
        )
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'Custom alias already taken'
      });
    });
  });

  describe('getLongUrl', () => {
    it('should return long URL for valid short URL', async () => {
      // Create a URL first
      const url = await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/test',
        'test123',
        'test-topic'
      );

      const longUrl = await UrlService.getLongUrl('test123');
      expect(longUrl).toBe('https://example.com/test');
    });

    it('should throw error for non-existent short URL', async () => {
      await expect(
        UrlService.getLongUrl('nonexistent')
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'Short URL not found'
      });
    });

    it('should use cache when available', async () => {
      const shortUrl = 'cached-test';
      const longUrl = 'https://example.com/cached';

      // Set cache
      await mockRedisClient.set(`url:${shortUrl}`, longUrl);

      // Should return from cache without database query
      const result = await UrlService.getLongUrl(shortUrl);
      expect(result).toBe(longUrl);
    });
  });

  describe('trackVisit', () => {
    let testUrl;

    beforeEach(async () => {
      // Create a test URL before tracking visits
      const result = await mockPool.query(
        'INSERT INTO urls (user_id, long_url, short_url, topic) VALUES ($1, $2, $3, $4) RETURNING *',
        [mockDbUser.google_id, 'https://example.com/test', 'test123', 'test-topic']
      );
      testUrl = result.rows[0];
    });

    it('should track visit with analytics data', async () => {
      const req = {
        ip: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent'
        }
      };

      await UrlService.trackVisit('test123', req);

      const result = await mockPool.query('SELECT * FROM visits WHERE url_id = $1', [testUrl.id]);
      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toMatchObject({
        visitor_ip: '127.0.0.1',
        user_agent: 'test-agent',
        device_type: 'desktop',
        os_type: 'Windows',
        browser_type: 'Chrome',
        country: 'US',
        city: 'New York'
      });
    });

    it('should update last_accessed timestamp', async () => {
      const req = {
        ip: '127.0.0.1',
        headers: {
          'user-agent': 'test-agent'
        }
      };

      const beforeVisit = new Date();
      await new Promise(resolve => setTimeout(resolve, 100)); // Ensure timestamp difference
      await UrlService.trackVisit('test123', req);

      const result = await mockPool.query('SELECT last_accessed FROM urls WHERE id = $1', [testUrl.id]);
      expect(result.rows[0].last_accessed).toBeDefined();
      const lastAccessed = new Date(result.rows[0].last_accessed);
      expect(lastAccessed).toBeInstanceOf(Date);
      expect(lastAccessed.getTime()).toBeGreaterThan(beforeVisit.getTime());
    });

    it('should throw error for non-existent URL', async () => {
      await expect(
        UrlService.trackVisit('nonexistent', mockReq)
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'Short URL not found'
      });
    });
  });

  describe('getUrlAnalytics', () => {
    let testUrl;

    beforeEach(async () => {
      // Create test URL and add visits
      const urlResult = await mockPool.query(
        'INSERT INTO urls (user_id, long_url, short_url, topic) VALUES ($1, $2, $3, $4) RETURNING *',
        [mockDbUser.google_id, 'https://example.com/analytics', 'analytics-test', 'test-topic']
      );
      testUrl = urlResult.rows[0];

      // Add a visit
      await mockPool.query(
        'INSERT INTO visits (url_id, visitor_ip, user_agent, device_type, os_type, browser_type, country, city) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)',
        [testUrl.id, '127.0.0.1', 'test-agent', 'desktop', 'Windows', 'Chrome', 'US', 'New York']
      );
    });

    it('should return complete analytics data', async () => {
      const analytics = await UrlService.getUrlAnalytics('analytics-test');

      expect(analytics).toMatchObject({
        totalClicks: 1,
        uniqueUsers: 1,
        clicksByDate: expect.any(Array),
        deviceType: expect.arrayContaining([
          expect.objectContaining({
            deviceName: 'desktop',
            uniqueClicks: 1,
            uniqueUsers: 1
          })
        ]),
        osType: expect.arrayContaining([
          expect.objectContaining({
            osName: 'windows',
            uniqueClicks: 1,
            uniqueUsers: 1
          })
        ])
      });
    });

    it('should throw error for non-existent URL', async () => {
      await expect(
        UrlService.getUrlAnalytics('nonexistent')
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'URL not found'
      });
    });
  });

  describe('getTopicAnalytics', () => {
    beforeEach(async () => {
      // Create multiple URLs with same topic
      await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/topic1',
        'topic-test1',
        'test-topic'
      );
      await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/topic2',
        'topic-test2',
        'test-topic'
      );

      // Add visits
      await UrlService.trackVisit('topic-test1', mockReq);
      await UrlService.trackVisit('topic-test2', mockReq);
    });

    it('should return topic analytics data', async () => {
      const analytics = await UrlService.getTopicAnalytics('test-topic');

      expect(analytics).toMatchObject({
        totalClicks: 2,
        uniqueUsers: 1,
        clicksByDate: expect.any(Array),
        urls: expect.arrayContaining([
          expect.objectContaining({
            shortUrl: 'topic-test1',
            totalClicks: 1,
            uniqueUsers: 1
          }),
          expect.objectContaining({
            shortUrl: 'topic-test2',
            totalClicks: 1,
            uniqueUsers: 1
          })
        ])
      });
    });

    it('should return empty stats for non-existent topic', async () => {
      const analytics = await UrlService.getTopicAnalytics('nonexistent');

      expect(analytics).toMatchObject({
        totalClicks: 0,
        uniqueUsers: 0,
        clicksByDate: [],
        urls: []
      });
    });

    it('should throw error when topic is not provided', async () => {
      await expect(
        UrlService.getTopicAnalytics()
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'Topic is required'
      });
    });
  });

  describe('getOverallAnalytics', () => {
    beforeEach(async () => {
      // Create multiple URLs
      await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/overall1',
        'overall-test1',
        'topic1'
      );
      await UrlService.createShortUrl(
        mockDbUser.google_id,
        'https://example.com/overall2',
        'overall-test2',
        'topic2'
      );

      // Add visits
      await UrlService.trackVisit('overall-test1', mockReq);
      await UrlService.trackVisit('overall-test2', mockReq);
    });

    it('should return overall analytics data', async () => {
      const analytics = await UrlService.getOverallAnalytics(mockDbUser.google_id);

      expect(analytics).toMatchObject({
        totalUrls: 2,
        totalClicks: 2,
        uniqueUsers: 1,
        clicksByDate: expect.any(Array),
        osType: expect.arrayContaining([
          expect.objectContaining({
            osName: 'Windows',
            uniqueClicks: '2',
            uniqueUsers: '1'
          })
        ]),
        deviceType: expect.arrayContaining([
          expect.objectContaining({
            deviceName: 'desktop',
            uniqueClicks: '2',
            uniqueUsers: '1'
          })
        ])
      });
    });

    it('should return empty stats for user with no URLs', async () => {
      const analytics = await UrlService.getOverallAnalytics('nonexistent-user');

      expect(analytics).toMatchObject({
        totalUrls: 0,
        totalClicks: 0,
        uniqueUsers: 0,
        clicksByDate: [],
        osType: [],
        deviceType: []
      });
    });
  });
}); 