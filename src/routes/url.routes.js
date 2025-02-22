const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const UrlService = require('../services/url.service');
const rateLimit = require('express-rate-limit');

// Rate limiting middleware
const createUrlLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Create short URL
router.post('/', authenticateToken, createUrlLimiter, async (req, res, next) => {
  try {
    const { longUrl, customAlias, topic } = req.body;
    
    if (!longUrl) {
      return res.status(400).json({ error: 'Long URL is required' });
    }

    const url = await UrlService.createShortUrl(req.user.userId, longUrl, customAlias, topic);
    
    res.json({
      shortUrl: `${process.env.NODE_ENV === 'production' ? process.env.PROD_URL : process.env.BASE_URL}/api/shorten/${url.short_url}`,
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