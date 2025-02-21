const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { pool } = require('./db');
const { logger } = require('./logger');

const setupPassport = () => {
  passport.serializeUser((user, done) => {
    done(null, user.google_id);
  });

  passport.deserializeUser(async (googleId, done) => {
    try {
      const result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
      if (!result.rows.length) {
        return done(null, false);
      }
      done(null, result.rows[0]);
    } catch (err) {
      done(err, null);
    }
  });

  passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      logger.info('Google profile received:', { 
        id: profile.id,
        email: profile.emails?.[0]?.value,
        name: profile.displayName
      });

      // Check if user exists
      const existingUser = await pool.query(
        'SELECT * FROM users WHERE google_id = $1',
        [profile.id]
      );

      if (existingUser.rows.length) {
        // Update existing user
        const user = (await pool.query(
          `UPDATE users 
           SET name = $1, 
               email = $2, 
               avatar = $3,
               last_login = CURRENT_TIMESTAMP,
               updated_at = CURRENT_TIMESTAMP
           WHERE google_id = $4 
           RETURNING *`,
          [profile.displayName, profile.emails[0].value, profile.photos?.[0]?.value, profile.id]
        )).rows[0];
        return done(null, user);
      }

      // Create new user
      const newUser = await pool.query(
        `INSERT INTO users (google_id, email, name, avatar, last_login) 
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP) 
         RETURNING *`,
        [profile.id, profile.emails[0].value, profile.displayName, profile.photos?.[0]?.value]
      );

      done(null, newUser.rows[0]);
    } catch (err) {
      logger.error('Passport Google strategy error:', { error: err.message, stack: err.stack });
      done(err, null);
    }
  }));
};

module.exports = { setupPassport }; 