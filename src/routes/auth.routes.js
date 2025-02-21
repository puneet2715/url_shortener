const express = require('express');
const passport = require('passport');
const router = express.Router();
const jwt = require('jsonwebtoken');

// Google OAuth login route
router.get('/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

// Google OAuth callback route
router.get('/google/callback',
  passport.authenticate('google', { failureRedirect: '/login' }),
  (req, res) => {
    // Generate JWT tokens
    const accessToken = jwt.sign(
      { userId: req.user.id },
      process.env.SESSION_SECRET,
      { expiresIn: '1h' }
    );

    const refreshToken = jwt.sign(
      { userId: req.user.id },
      process.env.SESSION_SECRET,
      { expiresIn: '7d' }
    );

    // Return tokens in response
    res.json({
      accessToken,
      refreshToken,
      user: {
        id: req.user.id,
        email: req.user.email,
        name: req.user.name
      }
    });
  }
);

// Logout route
router.get('/logout', (req, res) => {
  req.logout();
  res.json({ message: 'Logged out successfully' });
});

module.exports = router; 