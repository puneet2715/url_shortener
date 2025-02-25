const jwt = require('jsonwebtoken');
const { TokenService } = require('../services/token.service');

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    // Check if token is blacklisted
    const isBlacklisted = await TokenService.isTokenBlacklisted(token);
    if (isBlacklisted) {
      return res.status(401).json({ error: 'PLease login again' });
    }

    const decoded = jwt.verify(token, process.env.SESSION_SECRET);
    req.user = {
      userId: decoded.userId, // This is now the google id
      email: decoded.email,
      name: decoded.name,
      avatar: decoded.avatar
    };
    next();
  } catch (err) {
    return res.status(403).json({ error: 'Invalid or expired token' });
  }
};

module.exports = { authenticateToken }; 