const { Pool } = require('pg');
const Redis = require('redis');

// PostgreSQL configuration
const pool = new Pool({
  host: process.env.POSTGRES_HOST,
  port: process.env.POSTGRES_PORT,
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  max: 20, // Increase from default 10
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  statement_timeout: 2000
});

// Redis configuration
const redisClient = Redis.createClient({
  url: `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT}`,
  password: process.env.REDIS_PASSWORD || undefined,
  socket: {
    reconnectStrategy: (retries) => {
      console.log(`Redis reconnect attempt: ${retries}`);
      return Math.min(retries * 100, 3000); // Incremental backoff with max of 3 seconds
    }
  }
});

// Add better logging for Redis client events
redisClient.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis Client Connected');
});

redisClient.on('reconnecting', () => {
  console.log('Redis Client Reconnecting');
});

redisClient.on('ready', () => {
  console.log('Redis Client Ready');
});

// Connect with proper error handling
// (async () => {
//   try {
//     await redisClient.connect();
//   } catch (err) {
//     console.error('Failed to connect to Redis:', err);
//   }
// })();

// Ensure Redis client is connected
const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
};

module.exports = {
  pool,
  redisClient,
  connectRedis
}; 