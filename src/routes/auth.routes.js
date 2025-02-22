const express = require('express');
const passport = require('passport');
const router = express.Router();
const { AuthService } = require('../services/auth.service');
const { logger } = require('../config/logger');

// Google OAuth login route
router.get('/google',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    state: Date.now().toString()
  })
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

      const { user, accessToken, refreshToken } = await AuthService.handleGoogleLogin(req.user);
      
      // Store auth data in session for later use
      req.session.authData = {
        accessToken,
        refreshToken,
        user: {
          id: user.google_id,
          email: user.email,
          name: user.name,
          avatar: user.avatar
        }
      };

      // Redirect to API docs
      res.redirect('/api-docs');
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

// New endpoint to get stored auth data
router.get('/current-auth', (req, res) => {
  if (!req.session.authData) {
    return res.status(401).json({ 
      error: 'No authentication data',
      message: 'Please login first'
    });
  }
  res.json(req.session.authData);
});

// Logout route
router.get('/logout', (req, res) => {
  try {
    // Clear the authentication data from session
    req.session.authData = null;
    
    // Passport logout
    req.logout(() => {
      // Destroy the session
      req.session.destroy((err) => {
        if (err) {
          logger.error('Error destroying session:', err);
          return res.status(500).json({ 
            error: 'Logout Error',
            message: 'Failed to complete logout process'
          });
        }
        
        res.json({ message: 'Logged out successfully' });
      });
    });
  } catch (error) {
    logger.error('Logout error:', { 
      error: error.message, 
      stack: error.stack 
    });
    
    res.status(500).json({ 
      error: 'Logout Error',
      message: error.message || 'Failed to logout'
    });
  }
});

module.exports = router; 