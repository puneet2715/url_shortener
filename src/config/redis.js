const Redis = require('ioredis');

let redisClient;

if (process.env.NODE_ENV === 'test') {
  // In test environment, use the mock Redis client
  redisClient = require('../tests/mocks/redis');
} else {
  // In other environments, create a real Redis client
  redisClient = new Redis({
    host: process.env.REDIS_HOST || 'localhost',
    port: process.env.REDIS_PORT || 6379,
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_TLS === 'true'
  });
}

module.exports = redisClient; 