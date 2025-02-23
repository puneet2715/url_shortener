const validator = require('validator');

const validateUrl = (url) => {
  return validator.isURL(url, {
    protocols: ['http', 'https'],
    require_protocol: true,
    require_valid_protocol: true
  });
};

const validateEmail = (email) => {
  return validator.isEmail(email);
};

const sanitizeUrl = (url) => {
  return validator.trim(url);
};

module.exports = {
  validateUrl,
  validateEmail,
  sanitizeUrl
};
