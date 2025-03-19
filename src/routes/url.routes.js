const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const UrlService = require('../services/url.service');
// Remove the direct import of rate-limit
// const rateLimit = require('express-rate-limit');

// Import our custom rate limiter middleware
const { createUserRateLimiter } = require('../middleware/rate-limit.middleware');

// Rate limiting middleware - now using user ID-based limiting
const createUrlLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each user to 100 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'You have created too many short URLs. Please try again later.'
  }
});

// Create short URL
// Note: Put authenticateToken before the rate limiter so user ID is available
router.post('/', authenticateToken, createUrlLimiter, async (req, res, next) => {
  try {
    const { longUrl, customAlias, topic } = req.body;
    
    if (!longUrl) {
      return res.status(400).json({ error: 'Long URL is required' });
    }

    const url = await UrlService.createShortUrl(req.user.userId, longUrl, customAlias, topic);
    
    res.json({
      shortUrl: `${process.env.NODE_ENV === 'production' ? process.env.PROD_URL : process.env.BASE_URL}/api/shorten/${url.shortUrl}`,
      createdAt: url.created_at
    });
  } catch (err) {
    next(err);
  }
});

// Redirect to long URL
router.get('/:shortUrl', async (req, res, next) => {
  try {
    const { shortUrl } = req.params;
    const longUrl = await UrlService.getLongUrl(shortUrl);
    
    // Track the visit
    await UrlService.trackVisit(shortUrl, req);
    
    res.redirect(longUrl);
  } catch (err) {
    next(err);
  }
});

module.exports = router; 