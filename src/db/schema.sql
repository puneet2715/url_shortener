-- Users table
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    google_id VARCHAR(255) UNIQUE NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    name VARCHAR(255) NOT NULL,
    avatar VARCHAR(255),
    last_login TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- URLs table
CREATE TABLE IF NOT EXISTS urls (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) REFERENCES users(google_id),
    long_url TEXT NOT NULL,
    short_url VARCHAR(15) UNIQUE NOT NULL,
    topic VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP WITH TIME ZONE
);

-- Analytics table
CREATE TABLE IF NOT EXISTS analytics (
    id SERIAL PRIMARY KEY,
    url_id INTEGER REFERENCES urls(id),
    visitor_ip VARCHAR(45),
    user_agent TEXT,
    device_type VARCHAR(50),
    os_type VARCHAR(50),
    browser VARCHAR(50),
    country VARCHAR(2),
    city VARCHAR(100),
    visited_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Blacklisted tokens table
CREATE TABLE IF NOT EXISTS blacklisted_tokens (
    id SERIAL PRIMARY KEY,
    token TEXT NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    blacklisted_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_user
        FOREIGN KEY(user_id)
        REFERENCES users(google_id)
        ON DELETE CASCADE
);

-- Create indexes for better query performance
CREATE INDEX IF NOT EXISTS idx_urls_user_id ON urls(user_id);
CREATE INDEX IF NOT EXISTS idx_urls_short_url ON urls(short_url);
CREATE INDEX IF NOT EXISTS idx_analytics_url_id ON analytics(url_id);
CREATE INDEX IF NOT EXISTS idx_analytics_visited_at ON analytics(visited_at);

-- Create index for topic-based queries
CREATE INDEX IF NOT EXISTS idx_urls_topic ON urls(topic);

-- Create indexes for blacklisted tokens
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_token ON blacklisted_tokens(token);
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_user ON blacklisted_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_blacklisted_tokens_date ON blacklisted_tokens(blacklisted_at); 