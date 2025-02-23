const { Client } = require('pg');

async function initTestDatabase() {
  // Connect to PostgreSQL server to create test database
  const client = new Client({
    host: 'localhost',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: 'postgres'
  });

  try {
    await client.connect();
    
    // Check if database exists
    const result = await client.query(
      "SELECT 1 FROM pg_database WHERE datname = 'url_shorty_test'"
    );

    // Create database if it doesn't exist
    if (result.rows.length === 0) {
      await client.query('CREATE DATABASE url_shorty_test');
      console.log('Test database created successfully');
    } else {
      console.log('Test database already exists');
    }
  } catch (error) {
    console.error('Error initializing test database:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run if called directly
if (require.main === module) {
  initTestDatabase()
    .then(() => console.log('Database initialization complete'))
    .catch(error => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

module.exports = { initTestDatabase }; 