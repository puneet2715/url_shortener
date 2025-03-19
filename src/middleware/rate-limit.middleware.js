const rateLimit = require('express-rate-limit');
const { logger } = require('../config/logger');
const { redisClient } = require('../config/db');
const Redis = require('redis');

/**
 * Creates a rate limiter that identifies users by their user ID instead of IP address.
 * Falls back to IP-based limiting for unauthenticated requests.
 * 
 * @param {Object} options - Rate limit options
 * @returns {Function} Express middleware
 */
const createUserRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each user to 100 requests per window
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
    message: {
      error: 'Too Many Requests',
      message: 'Please try again later'
    },
    // Use a custom key generator that uses user ID when available, IP as fallback
    keyGenerator: (req) => {
      // If user is authenticated, use their ID
      if (req.user && req.user.userId) {
        return `user:${req.user.userId}`;
      }
      
      // Fall back to IP address for unauthenticated requests
      return req.ip;
    },
    // Skip rate limiting for certain users (e.g., admins) if needed
    skip: (req) => {
      // Example: Skip for specific users or roles
      // return req.user && req.user.role === 'admin';
      return false; // Don't skip by default
    },
    handler: (req, res) => {
      if (req.rateLimit.used === req.rateLimit.limit + 1) {
        logger.warn('Rate limit exceeded', {
          userId: req.user ? req.user.userId : 'anonymous',
          ip: req.ip,
          path: req.path
        }); 
      }
      
      // Send rate limit exceeded response
      res.status(429).json({
        error: 'Too Many Requests',
        message: 'Please try again later',
        retryAfter: Math.ceil(req.rateLimit.resetTime / 1000 - Date.now() / 1000)
      });
    }
  };

  // Merge default options with provided options
  const limiterOptions = { ...defaultOptions, ...options };
  
  // Create and return the rate limiter middleware
  return rateLimit(limiterOptions);
};

/**
 * Creates a Redis-backed rate limiter for better performance in production
 * Requires Redis to be configured
 */
const createRedisRateLimiter = (options = {}) => {
  // Only use Redis store if Redis client is ready
  if (!redisClient || !redisClient.isReady) {
    logger.warn('Redis client not ready, falling back to memory store for rate limiting');
    return createUserRateLimiter(options);
  }

  try {
    // Import Redis store for express-rate-limit
    const RedisStore = require('rate-limit-redis');
    
    const defaultOptions = {
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // limit each user to 100 requests per window
      standardHeaders: true,
      legacyHeaders: false,
      message: {
        error: 'Too Many Requests',
        message: 'Please try again later'
      },
      // Use a custom key generator that uses user ID when available, IP as fallback
      keyGenerator: (req) => {
        // If user is authenticated, use their ID
        if (req.user && req.user.userId) {
          return `user:${req.user.userId}`;
        }
        
        // Fall back to IP address for unauthenticated requests
        return req.ip;
      },
      // Use Redis as the store
      store: new RedisStore({
        // Use the existing Redis client
        client: redisClient,
        // Add prefix to distinguish rate limit keys
        prefix: 'ratelimit:'
      })
    };

    // Merge default options with provided options
    const limiterOptions = { ...defaultOptions, ...options };
    
    return rateLimit(limiterOptions);
  } catch (error) {
    logger.error('Failed to initialize Redis rate limiter:', error);
    // Fall back to memory-based limiter
    return createUserRateLimiter(options);
  }
};

module.exports = {
  createUserRateLimiter,
  createRedisRateLimiter
}; 