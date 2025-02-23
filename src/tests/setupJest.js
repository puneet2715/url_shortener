const { mockPool, mockDatabase } = require('./mocks/db');
const mockRedisClient = require('./mocks/redis');
const { mockGoogleProfile, mockDbUser } = require('./setup');

// Mock the database module
jest.mock('../config/db', () => ({
  pool: mockPool,
  redisClient: mockRedisClient
}));

// Mock external services
jest.mock('geoip-lite', () => ({
  lookup: jest.fn().mockReturnValue({
    country: 'US',
    city: 'New York'
  })
}));

jest.mock('ua-parser-js', () => jest.fn().mockReturnValue({
  device: { type: 'desktop' },
  os: { name: 'Windows' },
  browser: { name: 'Chrome' }
}));

// Mock middleware
jest.mock('express-rate-limit', () => () => (req, res, next) => next());

jest.mock('../middleware/auth.middleware', () => ({
  authenticateToken: (req, res, next) => {
    req.user = {
      userId: mockDbUser.google_id,
      email: mockDbUser.email,
      name: mockDbUser.name
    };
    next();
  }
}));

// Set up test environment variables
process.env.NODE_ENV = 'test';
process.env.PORT = '3000';
process.env.BASE_URL = 'http://localhost:3000';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.RATE_LIMIT_WINDOW_MS = '900000';
process.env.RATE_LIMIT_MAX_REQUESTS = '100';

// Initialize mock database and Redis before all tests
beforeAll(async () => {
  // Initialize database
  mockDatabase();
  
  // Initialize tables with test data
  await mockPool.query(
    'INSERT INTO users (google_id, email, name, avatar) VALUES ($1, $2, $3, $4)',
    [mockDbUser.google_id, mockDbUser.email, mockDbUser.name, mockDbUser.avatar]
  );
});

// Clear mock data before each test
beforeEach(async () => {
  // Clear tables but keep structure
  mockPool.clearTables();
  
  // Re-insert test user
  await mockPool.query(
    'INSERT INTO users (google_id, email, name, avatar) VALUES ($1, $2, $3, $4)',
    [mockDbUser.google_id, mockDbUser.email, mockDbUser.name, mockDbUser.avatar]
  );
  
  // Clear Redis cache
  await mockRedisClient.clear();
});

// Clean up after all tests
afterAll(async () => {
  await mockRedisClient.quit();
}); 