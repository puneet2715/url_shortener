const express = require('express');
const router = express.Router();
const { authenticateToken } = require('../middleware/auth.middleware');
const UrlService = require('../services/url.service');
const rateLimit = require('express-rate-limit');

// Rate limiting middleware
const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});

// Get URL analytics
router.get('/:alias', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const { alias } = req.params;
    const analytics = await UrlService.getUrlAnalytics(alias);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// Get topic-based analytics
router.get('/topic/:topic', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const { topic } = req.params;
    const analytics = await UrlService.getTopicAnalytics(topic);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

// Get overall analytics
router.get('/overall', authenticateToken, analyticsLimiter, async (req, res, next) => {
  try {
    const analytics = await UrlService.getOverallAnalytics(req.user.userId);
    res.json(analytics);
  } catch (err) {
    next(err);
  }
});

module.exports = router; 