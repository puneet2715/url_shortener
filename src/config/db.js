const { Pool } = require('pg');
const Redis = require('redis');

// PostgreSQL configuration
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
});

// Redis configuration
let redisClient;
if (process.env.NODE_ENV === 'test') {
  // In test environment, use the mock Redis client
  redisClient = require('../tests/mocks/redis');
} else {
  // In other environments, create a real Redis client
  redisClient = Redis.createClient({
    socket: {
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT
    },
    password: process.env.REDIS_PASSWORD || undefined
  });

  redisClient.on('error', (err) => console.log('Redis Client Error', err));
  redisClient.connect().catch(console.error);
}

module.exports = {
  pool,
  redisClient
}; 