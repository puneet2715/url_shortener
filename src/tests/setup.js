const { mockPool, mockDatabase } = require('./mocks/db');

// Mock user data
const mockGoogleProfile = {
  id: '123456789',
  displayName: 'Test User',
  emails: [{ value: 'test@example.com' }],
  photos: [{ value: 'https://example.com/photo.jpg' }]
};

const mockDbUser = {
  id: 1,
  google_id: '123456789',
  email: 'test@example.com',
  name: 'Test User',
  avatar: 'https://example.com/photo.jpg'
};

// Initialize mock tables
async function initTables() {
  try {
    // Initialize mock database
    mockDatabase();

    // Create mock tables
    mockPool.tables = {
      users: [],
      urls: [],
      visits: []
    };

    // Insert mock user
    await mockPool.query(
      'INSERT INTO users (google_id, email, name, avatar) VALUES ($1, $2, $3, $4)',
      [mockDbUser.google_id, mockDbUser.email, mockDbUser.name, mockDbUser.avatar]
    );
  } catch (error) {
    console.error('Error initializing mock tables:', error);
    throw error;
  }
}

// Clear all mock tables for testing
async function clearTables() {
  try {
    mockPool.tables = {
      users: [],
      urls: [],
      visits: []
    };
  } catch (error) {
    console.error('Error clearing mock tables:', error);
    throw error;
  }
}

// Global setup function
async function setup() {
  await initTables();
}

// Global teardown function
async function teardown() {
  await clearTables();
}

module.exports = {
  mockGoogleProfile,
  mockDbUser,
  mockPool,
  clearTables,
  setup,
  teardown
}; 