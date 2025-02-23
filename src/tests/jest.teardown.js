const { teardown } = require('./setup');
const mockRedisClient = require('./mocks/redis');

module.exports = async () => {
  // Clear Redis mock data
  mockRedisClient.clear();
  await mockRedisClient.quit();
  
  // Close database connection
  await teardown();
}; 