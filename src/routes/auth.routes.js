const express = require('express');
const passport = require('passport');
const router = express.Router();
const { AuthService } = require('../services/auth.service');
const { logger } = require('../config/logger');

// Google OAuth login route
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback route
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  async (req, res) => {
    try {
      logger.info('Google callback received:', { 
        user: req.user ? 'present' : 'missing',
        session: req.session ? 'present' : 'missing'
      });

      if (!req.user) {
        throw new Error('No user data received from Google authentication');
      }

      // Pass the entire profile object from Google
      const { user, accessToken, refreshToken } = await AuthService.handleGoogleLogin(req.user);
      
      res.json({
        accessToken,
        refreshToken,
        user: {
          id: user.google_id,
          email: user.email,
          name: user.name,
          avatar: user.avatar
        }
      });
    } catch (error) {
      logger.error('Authentication error:', { 
        error: error.message, 
        stack: error.stack,
        user: req.user 
      });

      res.status(500).json({ 
        error: 'Authentication Error',
        message: error.message || 'Failed to authenticate with Google'
      });
    }
  }
);

// Logout route
router.get('/logout', (req, res) => {
  req.logout(() => {
    res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router; 