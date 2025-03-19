// Save original NODE_ENV before dotenv can override it
// const originalNodeEnv = process.env.NODE_ENV;
// const originalNodeEnv = process.env.NODE_ENV;

// Load env variables from .env file
require('dotenv').config();

// Restore NODE_ENV if it was set before dotenv
// if (originalNodeEnv) {
//   process.env.NODE_ENV = originalNodeEnv;
// }
// if (originalNodeEnv) {
//   process.env.NODE_ENV = originalNodeEnv;
// }

// Make absolutely sure NODE_ENV is set to production in container
// if (process.env.NODE_ENV !== 'production') {
//   process.env.NODE_ENV = 'production';
// }
// if (process.env.NODE_ENV !== 'production') {
//   process.env.NODE_ENV = 'production';
// }

// Log the environment at startup
console.log(`Starting server with NODE_ENV=${process.env.NODE_ENV}`);

const express = require('express');
const session = require('express-session');
const passport = require('passport');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');
const path = require('path');
const morgan = require('morgan');
// Fix import format for connect-redis (for version 7+)
const { RedisStore } = require('connect-redis');

const { setupPassport } = require('./config/passport');
const { errorHandler } = require('./middleware/errorHandler');
const { logger, stream } = require('./config/logger');
const { redisClient } = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const urlRoutes = require('./routes/url.routes');
const analyticsRoutes = require('./routes/analytics.routes');
const { createRedisRateLimiter } = require('./middleware/rate-limit.middleware');

const SchedulerService = require('./services/scheduler.service');

// Log Node.js environment info
logger.info(`Node Version: ${process.version}`);
logger.info(`Environment Variables:`);
logger.info(`- NODE_ENV: ${process.env.NODE_ENV}`);
logger.info(`- PORT: ${process.env.PORT}`);
logger.info(`- REDIS_HOST: ${process.env.REDIS_HOST}`);
logger.info(`- REDIS_PORT: ${process.env.REDIS_PORT}`);

const app = express();

// Basic middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(cors());
app.use(helmet());

// Setup request logging
app.use(morgan('combined', { stream }));

// Session configuration with Redis for production
let sessionConfig = {
  secret: process.env.SESSION_SECRET || 'fallback_secret_dont_use_in_production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
};

// Use Redis as session store in production
if (process.env.NODE_ENV === 'development') {
  try {
    logger.info('Setting up Redis session store for production');
    
    if (!redisClient) {
      logger.error('Redis client is not defined - check db.js');
    } else {
      logger.info(`Redis client ready state: ${redisClient.isReady ? 'Ready' : 'Not Ready'}`);
      
      if (!redisClient.isReady) {
        logger.info('Redis client not ready, waiting for connection...');
        // Make sure we're connected or attempting to connect
        if (!redisClient.isOpen) {
          logger.info('Redis client not open, attempting to connect...');
          redisClient.connect().catch(err => {
            logger.error('Redis connection error:', err);
          });
        }
      }
      
      // Set up Redis store regardless - it will work once Redis connects
      sessionConfig.store = new RedisStore({
        client: redisClient,
        prefix: 'session:'
      });
      
      logger.info('Redis session store configured');
    }
  } catch (err) {
    logger.error('Failed to initialize Redis session store:', err);
    logger.warn('Falling back to MemoryStore (not recommended for production)');
  }
} else {
  logger.warn('Using MemoryStore for sessions (not recommended for production)');
}

// Log session configuration
logger.info('Session configuration:', {
  secure: sessionConfig.cookie.secure,
  store: sessionConfig.store ? 'Redis Store' : 'Memory Store'
});

app.use(session(sessionConfig));

// Passport configuration
app.use(passport.initialize());
app.use(passport.session());
setupPassport();

// Global rate limiting for all API routes
// const apiLimiter = createRedisRateLimiter({
//   windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes by default
//   max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // 100 requests per window by default
//   message: {
//     error: 'Too Many Requests',
//     message: 'Too many requests from this user, please try again later'
//   }
// });

// Apply rate limiting to all API routes
// app.use('/api/', apiLimiter);

// Swagger documentation
const swaggerDocument = YAML.load(path.join(__dirname, 'docs/swagger.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.use('/auth', authRoutes);
app.use('/api/shorten', urlRoutes);
app.use('/api/analytics', analyticsRoutes);

// Error handling
app.use(errorHandler);

// Initialize the scheduler
SchedulerService.init();

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.debug('Debug logging enabled');
}); 

// Handle graceful shutdown
process.on('SIGTERM', async () => {
  logger.info('SIGTERM received. Stopping cron jobs...');
  SchedulerService.stopAll();
  // ... other cleanup
  process.exit(0);
});