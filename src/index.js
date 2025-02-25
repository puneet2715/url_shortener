// Save original NODE_ENV before dotenv can override it
const originalNodeEnv = process.env.NODE_ENV;

// Load env variables from .env file
require('dotenv').config();

// Restore NODE_ENV if it was set before dotenv
if (originalNodeEnv) {
  process.env.NODE_ENV = originalNodeEnv;
}

// Make absolutely sure NODE_ENV is set to production in container
if (process.env.NODE_ENV !== 'production') {
  process.env.NODE_ENV = 'production';
}

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
const RedisStore = require('connect-redis').default;

const { setupPassport } = require('./config/passport');
const { errorHandler } = require('./middleware/errorHandler');
const { logger, stream } = require('./config/logger');
const { redisClient } = require('./config/db');
const authRoutes = require('./routes/auth.routes');
const urlRoutes = require('./routes/url.routes');
const analyticsRoutes = require('./routes/analytics.routes');

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
if (process.env.NODE_ENV === 'production') {
  try {
    logger.info('Setting up Redis session store for production');
    
    if (!redisClient) {
      logger.error('Redis client is not defined - check db.js');
    } else {
      logger.info(`Redis client ready state: ${redisClient.isReady ? 'Ready' : 'Not Ready'}`);
      
      if (!redisClient.isReady) {
        logger.info('Redis client not ready, waiting for connection...');
      }
      
      // Set up Redis store regardless - it will work once Redis connects
      sessionConfig.store = new RedisStore({ 
        client: redisClient,
        prefix: 'session:',
        logErrors: true
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

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100
});
app.use('/api/', limiter);

// Swagger documentation
const swaggerDocument = YAML.load(path.join(__dirname, 'docs/swagger.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// Routes
app.use('/auth', authRoutes);
app.use('/api/shorten', urlRoutes);
app.use('/api/analytics', analyticsRoutes);

// Error handling
app.use(errorHandler);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  logger.info(`Server is running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  logger.debug('Debug logging enabled');
}); 