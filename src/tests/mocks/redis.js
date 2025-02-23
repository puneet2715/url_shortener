// Mock Redis client for testing
class MockRedis {
  constructor() {
    this.store = new Map();
  }

  async get(key) {
    return this.store.get(key);
  }

  async set(key, value, options = {}) {
    this.store.set(key, value);
    return 'OK';
  }

  async del(key) {
    this.store.delete(key);
    return 1;
  }

  async incr(key) {
    const value = (parseInt(this.store.get(key) || '0', 10) + 1).toString();
    this.store.set(key, value);
    return value;
  }

  async expire(key, seconds) {
    return 1;
  }

  async ttl(key) {
    return this.store.has(key) ? 3600 : -2;
  }

  async quit() {
    this.store.clear();
    return 'OK';
  }

  clear() {
    this.store.clear();
  }
}

// Create a singleton instance
const mockRedisClient = new MockRedis();

module.exports = mockRedisClient; 