const { pool } = require('../config/db');
const { logger } = require('../config/logger');

class TokenService {
  static async blacklistToken(token, userId) {
    try {
      await pool.query(
        `INSERT INTO blacklisted_tokens (token, user_id, blacklisted_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)`,
        [token, userId]
      );
    } catch (error) {
      logger.error('Error blacklisting token:', { error: error.message, userId });
      throw error;
    }
  }

  static async isTokenBlacklisted(token) {
    try {
      const result = await pool.query(
        'SELECT EXISTS(SELECT 1 FROM blacklisted_tokens WHERE token = $1)',
        [token]
      );
      return result.rows[0].exists;
    } catch (error) {
      logger.error('Error checking blacklisted token:', { error: error.message });
      throw error;
    }
  }

  // Cleanup expired tokens periodically
  static async cleanupBlacklistedTokens() {
    try {
      await pool.query(
        'DELETE FROM blacklisted_tokens WHERE blacklisted_at < NOW() - INTERVAL \'7 days\''
      );
    } catch (error) {
      logger.error('Error cleaning up blacklisted tokens:', { error: error.message });
    }
  }
}

module.exports = { TokenService }; 