const { pool } = require('../config/db');
const jwt = require('jsonwebtoken');
const { logger } = require('../config/logger');

class AuthService {
  static async handleGoogleLogin(profile) {
    try {
      logger.info('Received profile:', { profile });

      if (!profile) {
        throw new Error('No profile data received');
      }

      // If this is a database user object (from deserialize)
      if (profile.google_id) {
        logger.info('Using existing user profile');
        const accessToken = jwt.sign(
          { 
            userId: profile.google_id,
            email: profile.email,
            name: profile.name,
            avatar: profile.avatar
          },
          process.env.SESSION_SECRET,
          { expiresIn: '1h' }
        );

        const refreshToken = jwt.sign(
          { userId: profile.google_id },
          process.env.SESSION_SECRET,
          { expiresIn: '7d' }
        );

        return { 
          user: profile, 
          accessToken,
          refreshToken
        };
      }

      // Otherwise, handle as a new Google profile
      const googleId = profile.id || profile._json?.sub;
      const email = profile.emails?.[0]?.value || profile._json?.email;
      const name = profile.displayName || profile._json?.name;
      const avatar = profile.photos?.[0]?.value || profile._json?.picture;

      if (!googleId || !email || !name) {
        logger.error('Missing required profile data:', { googleId, email, name });
        throw new Error('Missing required profile data from Google');
      }

      logger.info('Extracted profile data:', { googleId, email, name, avatar });

      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE google_id = $1',
        [googleId]
      );

      let user;
      if (existingUser.rows.length) {
        // Update existing user
        user = (await pool.query(
          `UPDATE users 
           SET name = $1, 
               email = $2, 
               avatar = $3,
               last_login = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE google_id = $4 
           RETURNING *`,
          [name, email, avatar, googleId]
        )).rows[0];
      } else {
        // Create new user
        user = (await pool.query(
          `INSERT INTO users (google_id, email, name, avatar, last_login) 
           VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
           RETURNING *`,
          [googleId, email, name, avatar]
        )).rows[0];
      }

      // Generate tokens
      const accessToken = jwt.sign(
        { 
          userId: user.google_id,
          email: user.email,
          name: user.name,
          avatar: user.avatar
        },
        process.env.SESSION_SECRET,
        { expiresIn: '1h' }
      );

      const refreshToken = jwt.sign(
        { userId: user.google_id },
        process.env.SESSION_SECRET,
        { expiresIn: '7d' }
      );

      return { 
        user,
        accessToken,
        refreshToken
      };
    } catch (error) {
      logger.error('Google login error:', { error: error.message, stack: error.stack });
      throw {
        type: 'auth',
        message: 'Failed to handle Google login',
        details: error.message
      };
    }
  }
}

module.exports = { AuthService }; 