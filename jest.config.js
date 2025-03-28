module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov'],
  // Add moduleNameMapper for mocks if needed later
  // moduleNameMapper: {
  //   '^../db$': '<rootDir>/tests/__mocks__/db.js',
  // },
};