require('dotenv').config();
const { pool } = require('../config/db');
const fs = require('fs').promises;
const path = require('path');

async function initializeDatabase() {
  try {
    // Read the schema file
    const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
    const schema = await fs.readFile(schemaPath, 'utf8');

    // Execute the schema
    await pool.query(schema);
    console.log('Database tables created successfully');

    // Close the pool
    await pool.end();
    
    // Exit successfully
    process.exit(0);
  } catch (error) {
    console.error('Error initializing database:', error);
    process.exit(1);
  }
}

initializeDatabase(); 