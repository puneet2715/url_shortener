const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
// Replace UrlService with AnalyticsService
const AnalyticsService = require('../services/analytics.service');
// Remove the direct import of rate-limit
// const rateLimit = require('express-rate-limit');

// Import our custom rate limiter middleware
const { createUserRateLimiter } = require('../middleware/rate-limit.middleware');

// Rate limiting middleware - now using user ID-based limiting
const analyticsLimiter = createUserRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each user to 100 requests per windowMs
  message: {
    error: 'Too Many Requests',
    message: 'You have made too many analytics requests. Please try again later.'
  }
});

// Get overall analytics - This must come before /:alias route
// Note: Put authenticateToken before the rate limiter so user ID is available
router.get('/overall', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const analytics = await AnalyticsService.getOverallAnalytics(req.user.userId);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// Get topic-based analytics - This must come before /:alias route
// Note: Put authenticateToken before the rate limiter so user ID is available
router.get('/topic/:topic', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const { topic } = req.params;
    const analytics = await AnalyticsService.getTopicAnalytics(topic);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// Get URL analytics
// Note: Put authenticateToken before the rate limiter so user ID is available
router.get('/:alias', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const { alias } = req.params;
    const analytics = await AnalyticsService.getUrlAnalytics(alias);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

module.exports = router; 