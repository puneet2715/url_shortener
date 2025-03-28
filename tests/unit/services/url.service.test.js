const { nanoid } = require('nanoid');
const { pool, redisClient, connectRedis } = require('../../../src/config/db');
const UAParser = require('ua-parser-js');
const geoip = require('geoip-lite');
const { logger } = require('../../../src/config/logger');
const UrlService = require('../../../src/services/url.service');

// Mock all dependencies
jest.mock('nanoid');
jest.mock('../../../src/config/db', () => ({
  pool: {
    query: jest.fn()
  },
  redisClient: {
    isReady: true,
    multi: jest.fn().mockReturnThis(),
    hSet: jest.fn().mockReturnThis(),
    sAdd: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(true),
    hGetAll: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    sRem: jest.fn()
  },
  connectRedis: jest.fn().mockResolvedValue(true)
}));
jest.mock('ua-parser-js');
jest.mock('geoip-lite');
jest.mock('../../../src/config/logger');

describe('UrlService', () => {
  // Mock data
  const mockUserId = 'user123';
  const mockLongUrl = 'https://example.com';
  const mockShortUrl = 'abc123';
  const mockTopic = 'test-topic';
  const mockUrlData = {
    userId: mockUserId,
    longUrl: mockLongUrl,
    shortUrl: mockShortUrl,
    topic: mockTopic,
    createdAt: Date.now().toString(),
    status: 'pending'
  };

  beforeEach(() => {
    // Reset all mocks before each test
    jest.clearAllMocks();

    // Setup nanoid mock
    nanoid.mockReturnValue(mockShortUrl);
  });

  describe('createShortUrl', () => {
    it('should create a short URL with custom alias', async () => {
      // Mock database query to return no existing URL
      pool.query.mockResolvedValueOnce({ rows: [] });

      // Mock Redis operations
      redisClient.exec.mockResolvedValueOnce(true);

      const result = await UrlService.createShortUrl(mockUserId, mockLongUrl, mockShortUrl, mockTopic);

      // Verify nanoid was not called (using custom alias)
      expect(nanoid).not.toHaveBeenCalled();

      // Verify database check for existing URL
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT id FROM urls WHERE short_url = $1',
        [mockShortUrl]
      );

      // Verify Redis operations
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        expect.objectContaining({
          userId: mockUserId,
          longUrl: mockLongUrl,
          shortUrl: mockShortUrl,
          topic: mockTopic,
          status: 'pending'
        })
      );
      expect(redisClient.sAdd).toHaveBeenCalledWith('pending_urls', mockShortUrl);
      expect(redisClient.expire).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        24 * 60 * 60
      );

      // Verify result
      expect(result).toEqual({
        ...mockUrlData,
        createdAt: expect.any(Date)
      });
    });

    it('should create a short URL with generated alias', async () => {
      // Mock database query to return no existing URL
      pool.query.mockResolvedValueOnce({ rows: [] });

      // Mock Redis operations
      redisClient.exec.mockResolvedValueOnce(true);

      const result = await UrlService.createShortUrl(mockUserId, mockLongUrl, null, mockTopic);

      // Verify nanoid was called
      expect(nanoid).toHaveBeenCalledWith(8);

      // Verify database check was not performed (no custom alias)
      expect(pool.query).not.toHaveBeenCalled();

      // Verify Redis operations
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        expect.objectContaining({
          userId: mockUserId,
          longUrl: mockLongUrl,
          shortUrl: mockShortUrl,
          topic: mockTopic,
          status: 'pending'
        })
      );

      // Verify result
      expect(result).toEqual({
        ...mockUrlData,
        createdAt: expect.any(Date)
      });
    });

    it('should throw error if custom alias is already taken', async () => {
        // Mock database query to return existing URL
        pool.query.mockResolvedValueOnce({ rows: [{ id: 1 }] });
        
        UrlService.createShortUrl(mockUserId, mockLongUrl, mockShortUrl, mockTopic);
      
        await expect(
            UrlService.createShortUrl(mockUserId, mockLongUrl, mockShortUrl, mockTopic)
        ).rejects.toMatchObject({
            type: 'validation',
            message: 'Custom alias already taken',
            details: 'Please choose a different custom alias'
        });
    });
  });

  describe('getLongUrl', () => {
    it('should return long URL from Redis hash', async () => {
      // Mock Redis hash data
      redisClient.hGetAll.mockResolvedValueOnce({
        longUrl: mockLongUrl
      });

      const result = await UrlService.getLongUrl(mockShortUrl);

      // Verify Redis operations
      expect(redisClient.hGetAll).toHaveBeenCalledWith(`url:${mockShortUrl}`);
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        'lastAccessed',
        expect.any(String)
      );

      // Verify result
      expect(result).toBe(mockLongUrl);
    });

    it('should return long URL from legacy Redis key', async () => {
      // Mock Redis hash to return empty
      redisClient.hGetAll.mockResolvedValueOnce({});
      // Mock legacy Redis key
      redisClient.get.mockResolvedValueOnce(mockLongUrl);

      const result = await UrlService.getLongUrl(mockShortUrl);

      // Verify Redis operations
      expect(redisClient.hGetAll).toHaveBeenCalledWith(`url:${mockShortUrl}`);
      expect(redisClient.get).toHaveBeenCalledWith(`url:${mockShortUrl}`);

      // Verify result
      expect(result).toBe(mockLongUrl);
    });

    it('should return long URL from PostgreSQL and cache it', async () => {
      // Mock Redis to return no data
      redisClient.hGetAll.mockResolvedValueOnce({});
      redisClient.get.mockResolvedValueOnce(null);

      // Mock PostgreSQL query
      pool.query.mockResolvedValueOnce({
        rows: [{
          long_url: mockLongUrl,
          last_accessed: new Date()
        }]
      });

      const result = await UrlService.getLongUrl(mockShortUrl);

      // Verify database query
      expect(pool.query).toHaveBeenCalledWith(
        'SELECT long_url, last_accessed FROM urls WHERE short_url = $1',
        [mockShortUrl]
      );

      // Verify Redis caching
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        'longUrl',
        mockLongUrl
      );
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        'shortUrl',
        mockShortUrl
      );
      expect(redisClient.hSet).toHaveBeenCalledWith(
        `url:${mockShortUrl}`,
        'lastAccessed',
        expect.any(String)
      );

      // Verify result
      expect(result).toBe(mockLongUrl);
    });

    it('should throw error if URL not found', async () => {
      // Mock Redis to return no data
      redisClient.hGetAll.mockResolvedValueOnce({});
      redisClient.get.mockResolvedValueOnce(null);

      // Mock PostgreSQL query to return no rows
      pool.query.mockResolvedValueOnce({ rows: [] });

      await expect(
        UrlService.getLongUrl(mockShortUrl)
      ).rejects.toMatchObject({
        type: 'validation',
        message: 'Short URL not found',
        details: 'The specified short URL does not exist'
      });
    });
  });
}); 