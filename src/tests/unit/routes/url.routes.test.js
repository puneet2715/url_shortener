// Import Redis mock before other imports
const mockRedisClient = require('../../mocks/redis');

const request = require('supertest');
const express = require('express');
const { mockGoogleProfile, mockDbUser, clearTables } = require('../../setup');
const { pool } = require('../../../config/db');
const { errorHandler } = require('../../../middleware/errorHandler');
const { mockPool, mockDatabase } = require('../../mocks/db');

// Create express app for testing
const app = express();
app.use(express.json());
app.use(errorHandler);

// Mock environment variables
process.env.BASE_URL = 'http://localhost:3000';
process.env.NODE_ENV = 'test';

// Mock authentication middleware
jest.mock('../../../middleware/auth.middleware', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      userId: mockDbUser.google_id,
      email: mockDbUser.email,
      name: mockDbUser.name
    };
    next();
  }
}));

// Mock rate limiter
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

// Mock ua-parser-js
jest.mock('ua-parser-js', () => jest.fn().mockReturnValue({
  device: { type: 'desktop' },
  os: { name: 'Windows' },
  browser: { name: 'Chrome' }
}));

// Import routes after mocking
const urlRoutes = require('../../../routes/url.routes');

// Add routes
app.use('/api/urls', urlRoutes);

describe('URL Routes', () => {
  let app;

  beforeAll(() => {
    mockDatabase();
  });

  beforeEach(async () => {
    // Create Express app
    app = express();
    app.use(express.json());

    // Mock authentication middleware
    app.use((req, res, next) => {
      req.user = mockDbUser;
      next();
    });

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

    // Add routes and error handler
    app.use('/api/urls', urlRoutes);
    app.use(errorHandler);
  });

  describe('POST /api/urls', () => {
    it('should create a short URL', async () => {
      const response = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/very/long/url',
          topic: 'test'
        });

      if (response.status !== 200) {
        console.error('Response Error:', response.body);
      }

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('shortUrl');
      expect(response.body.shortUrl).toContain(process.env.BASE_URL);

      // Verify the URL was created in the database
      const result = await mockPool.query('SELECT * FROM urls WHERE long_url = $1', [
        'https://example.com/very/long/url'
      ]);
      expect(result.rows[0]).toHaveProperty('created_at');
      expect(response.body).toHaveProperty('createdAt', result.rows[0].created_at);
    });

    it('should create a short URL with custom alias', async () => {
      const customAlias = 'custom-test';
      const response = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/very/long/url',
          customAlias,
          topic: 'test'
        });

      expect(response.status).toBe(200);
      expect(response.body.shortUrl).toContain(customAlias);
    });

    it('should reject duplicate custom alias', async () => {
      const customAlias = 'unique-test';
      
      // Create first URL
      await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/first',
          customAlias,
          topic: 'test'
        });

      // Try to create second URL with same alias
      const response = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/second',
          customAlias,
          topic: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('Custom alias already taken');
    });

    it('should reject request without long URL', async () => {
      const response = await request(app)
        .post('/api/urls')
        .send({
          topic: 'test'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Long URL is required');
    });

    it('should store URL with user ID from auth', async () => {
      const response = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/auth-test',
          topic: 'test'
        });

      expect(response.status).toBe(200);

      // Verify in database
      const result = await mockPool.query('SELECT user_id FROM urls WHERE long_url = $1', [
        'https://example.com/auth-test'
      ]);
      expect(result.rows[0].user_id).toBe(mockDbUser.google_id);
    });
  });

  describe('GET /api/urls/:shortUrl', () => {
    it('should redirect to long URL', async () => {
      // First create a short URL
      const createResponse = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/target',
          customAlias: 'test-redirect',
          topic: 'test'
        });

      if (createResponse.status !== 200) {
        console.error('Create URL Error:', createResponse.body);
      }

      expect(createResponse.status).toBe(200);

      // Get the short code
      const shortCode = 'test-redirect';

      // Then try to access it
      const response = await request(app)
        .get(`/api/urls/${shortCode}`);

      if (response.status !== 302) {
        console.error('Redirect Error:', response.body);
      }

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('https://example.com/target');
    });

    it('should handle non-existent short URL', async () => {
      const response = await request(app)
        .get('/api/urls/nonexistent');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Validation Error');
      expect(response.body.message).toContain('Short URL not found');
    });

    it('should track visit analytics', async () => {
      // First create a short URL
      const createResponse = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/analytics-test',
          customAlias: 'analytics-test',
          topic: 'test'
        });

      expect(createResponse.status).toBe(200);

      // Get the URL ID
      const urlResult = await mockPool.query('SELECT id FROM urls WHERE short_url = $1', ['analytics-test']);
      const urlId = urlResult.rows[0].id;

      // Visit the URL
      const response = await request(app)
        .get('/api/urls/analytics-test')
        .set('User-Agent', 'test-agent')
        .set('X-Forwarded-For', '127.0.0.1');

      expect(response.status).toBe(302);
      expect(response.header.location).toBe('https://example.com/analytics-test');

      // Wait a bit to ensure visit is recorded
      await new Promise(resolve => setTimeout(resolve, 100));

      // Check analytics record
      const result = await mockPool.query('SELECT * FROM visits WHERE url_id = $1', [urlId]);
      expect(result.rows.length).toBe(1);
      expect(result.rows[0]).toMatchObject({
        visitor_ip: '127.0.0.1',
        user_agent: 'test-agent',
        device_type: 'desktop',
        os_type: 'Windows',
        browser_type: 'Chrome',
        country: 'US',
        city: 'New York'
      });

      // Check that last_accessed was updated
      const urlUpdate = await mockPool.query('SELECT last_accessed FROM urls WHERE id = $1', [urlId]);
      expect(urlUpdate.rows[0].last_accessed).toBeDefined();
      expect(new Date(urlUpdate.rows[0].last_accessed)).toBeInstanceOf(Date);
    });

    it('should use Redis cache for frequently accessed URLs', async () => {
      // Create a short URL
      const createResponse = await request(app)
        .post('/api/urls')
        .send({
          longUrl: 'https://example.com/cache-test',
          topic: 'test'
        });

      const shortUrl = createResponse.body.shortUrl;
      const shortCode = shortUrl.split('/').pop();

      // First visit - should cache the URL
      await request(app).get(`/api/urls/${shortCode}`);

      // Second visit - should use cache
      const cachedUrl = await mockRedisClient.get(`url:${shortCode}`);
      expect(cachedUrl).toBe('https://example.com/cache-test');

      // Verify redirect still works with cached URL
      const response = await request(app).get(`/api/urls/${shortCode}`);
      expect(response.status).toBe(302);
      expect(response.header.location).toBe('https://example.com/cache-test');
    });
  });
}); 