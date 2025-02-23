const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const UrlService = require('../services/url.service');
const rateLimit = require('express-rate-limit');
const { validateUrl } = require('../utils/validator');

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

    if (!validateUrl(longUrl)) {
      return res.status(400).json({ error: 'Invalid URL format' });
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
    
    // Get the long URL first
    const longUrl = await UrlService.getLongUrl(shortUrl);
    
    // If we got here, the URL exists, so track the visit
    // Use .catch to handle any tracking errors without affecting the redirect
    UrlService.trackVisit(shortUrl, req).catch(err => {
      console.error('Error tracking visit:', err);
    });
    
    // Redirect to the long URL
    return res.redirect(longUrl);
  } catch (err) {
    // Pass validation errors to the error handler
    if (err.type === 'validation') {
      return next(err);
    }
    
    // For any other errors, log them but return a generic error
    console.error('Error handling redirect:', err);
    return next(new Error('Failed to process URL'));
  }
});

module.exports = router; 