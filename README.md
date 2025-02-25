# Advanced URL Shortener with Analytics

A comprehensive URL shortening service with advanced analytics, custom aliases, and rate limiting capabilities. Built with Node.js, Express, PostgreSQL, and Redis.

## Features

- **User Authentication**: Secure login via Google OAuth
- **URL Shortening**: Create short URLs with optional custom aliases
- **Topic-based Organization**: Group URLs under specific topics (e.g., acquisition, activation, retention)
- **Advanced Analytics**:
  - Total clicks and unique visitors
  - Click statistics by date (last 7 days)
  - OS and device type analytics
  - Topic-based analytics
  - Overall user analytics
- **Rate Limiting**: Prevent abuse of the API
- **Caching**: Redis-based caching for improved performance
- **API Documentation**: Swagger/OpenAPI documentation
- **Containerization**: Docker support for easy deployment
- **CI/CD**: Continuous Integration/Continuous Deployment via GitHub Actions

## Prerequisites

- Node.js (v20 or later)
- PostgreSQL (hosted on VPS)
- Redis (hosted on VPS)
- Google OAuth credentials

## Environment Variables

Create a `.env` file in the root directory with the following variables:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# Database Configuration
POSTGRES_HOST=your_postgres_host
POSTGRES_PORT=5432
POSTGRES_DB=url_shorty
POSTGRES_USER=your_postgres_user
POSTGRES_PASSWORD=your_postgres_password

# Redis Configuration
REDIS_HOST=your_redis_host
REDIS_PORT=6379
REDIS_PASSWORD=your_redis_password

# Google OAuth Configuration
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# Session Configuration
SESSION_SECRET=your_session_secret

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000  # 15 minutes
RATE_LIMIT_MAX_REQUESTS=100

# URL Configuration
BASE_URL=http://localhost:3000
PROD_URL=https://your-production-domain.com  # Production URL for redirects in production environment
```

## Database Setup

1. Create a PostgreSQL database:
```sql
CREATE DATABASE url_shorty;
```

2. Run the database migrations using one of the following methods:

   a. Using the provided init-db script:
   ```bash
   npm run init-db
   ```

   b. Manually with SQL file:
   ```bash
   psql -U your_postgres_user -d url_shorty -f src/db/schema.sql
   ```

## Data Model

The application uses the following data model:

### Database Schema

```
Table Users {
  id int [pk]
  google_id varchar
  email varchar
  name varchar
  picture varchar
  created_at timestamp
  updated_at timestamp
}

Table URLs {
  id int [pk]
  user_id int [ref: > Users.id]
  original_url varchar
  short_code varchar
  topic varchar
  created_at timestamp
  updated_at timestamp
  expiration_date timestamp
}

Table Clicks {
  id int [pk]
  url_id int [ref: > URLs.id]
  timestamp timestamp
  ip_address varchar
  user_agent varchar
  referrer varchar
  country varchar
  device_type varchar
  browser varchar
  os varchar
}

Table Topics {
  id int [pk]
  name varchar
  description text
  created_at timestamp
  updated_at timestamp
}

Table URL_Analytics {
  url_id int [pk, ref: - URLs.id]
  total_clicks int
  unique_visitors int
  last_accessed timestamp
}
```

> Note: View the database diagram at [dbdiagram.io](https://dbdiagram.io/d/Url-Shortener-Alter-Office-67bd8328263d6cf9a05cd8d4).

### Table Descriptions

1. **Users**: Stores user information from Google OAuth authentication.
   - Primary key: `id` (auto-incremented)
   - Unique identifier: `google_id` (from Google OAuth)
   - User data: `email`, `name`, `picture`
   - Timestamps: `created_at`, `updated_at`

2. **URLs**: Stores the mapping between original URLs and their shortened versions.
   - Primary key: `id` (auto-incremented)
   - Foreign key: `user_id` (references Users.id)
   - URL data: `original_url`, `short_code`, `topic`
   - Timestamps: `created_at`, `updated_at`, `expiration_date`

3. **Clicks**: Records each click/visit to a shortened URL.
   - Primary key: `id` (auto-incremented)
   - Foreign key: `url_id` (references URLs.id)
   - Click data: `timestamp`, `ip_address`, `user_agent`, `referrer`
   - Analytics data: `country`, `device_type`, `browser`, `os`

4. **Topics**: Categorizes URLs for organizational purposes.
   - Primary key: `id` (auto-incremented)
   - Topic data: `name`, `description`
   - Timestamps: `created_at`, `updated_at`

5. **URL_Analytics**: Aggregated analytics data for each URL.
   - Foreign key: `url_id` (references URLs.id)
   - Analytics data: `total_clicks`, `unique_visitors`, `last_accessed`

### Key Relationships

- A User can create multiple URLs (one-to-many)
- A URL belongs to a single User (many-to-one)
- A URL can be optionally categorized under a Topic (many-to-one)
- A URL has many Clicks (one-to-many)
- Each URL has aggregated analytics (one-to-one)

## Installation

1. Install dependencies:
```bash
npm install
```

2. Start the server:
```bash
npm start
```

For development:
```bash
npm run dev
```

## Docker Deployment

### Using Docker Compose (Recommended)

1. Make sure you have Docker and Docker Compose installed on your system.

2. Create necessary directories for persistent data:
```bash
mkdir -p logs uploads
```

3. Start the application:
```bash
docker-compose up -d
```

4. View logs:
```bash
docker-compose logs -f
```

5. Stop the application:
```bash
docker-compose down
```

### Using Docker Directly

1. Build the Docker image:
```bash
docker build -t url-shorty .
```

2. Run the container:
```bash
docker run -p 3000:3000 --env-file .env url-shorty
```

## CI/CD Setup

This project uses GitHub Actions for Continuous Integration and Continuous Deployment to automatically deploy changes to the VPS when code is merged to the main branch.

### GitHub Secrets Required

Set up the following secrets in your GitHub repository settings:

- `DOCKERHUB_USERNAME`: Your Docker Hub username
- `DOCKERHUB_TOKEN`: Docker Hub access token (create in Docker Hub settings)
- `VPS_HOST`: Your VPS IP address
- `VPS_USERNAME`: SSH username for your VPS
- `VPS_SSH_KEY`: SSH private key for VPS access

### Workflow Process

1. When code is pushed to the `main` branch:
   - GitHub Actions builds a multi-architecture Docker image (amd64/arm64)
   - Pushes the image to Docker Hub
   - Connects to your VPS via SSH
   - Pulls the latest image and restarts the container

### Manual Deployment

If you need to manually deploy:

1. SSH into your VPS
2. Navigate to the application directory:
```bash
cd /root/docker/url_shortener_alter_office
```

3. Pull the latest image and restart:
```bash
docker compose down
docker rmi puneet2109/url-shorty:latest || true
docker compose pull
docker compose up -d
```

## API Documentation

Access the Swagger documentation at:
```
http://localhost:3000/api-docs
```

## API Endpoints

### Authentication
- `GET /auth/google`: Initiate Google OAuth login
- `GET /auth/google/callback`: Google OAuth callback
  - Returns: Access token, refresh token, and user information
- `GET /auth/logout`: Logout

### URL Operations
- `POST /api/shorten`: Create short URL
  - Requires authentication
  - Body: 
    ```json
    {
      "longUrl": "https://example.com/very/long/url",
      "customAlias": "custom-alias",  // optional
      "topic": "acquisition"  // optional
    }
    ```
  - Returns: Short URL and creation timestamp

- `GET /api/shorten/{alias}`: Redirect to original URL
  - Public endpoint
  - Tracks visit analytics

### Analytics
- `GET /api/analytics/{alias}`: Get URL analytics
  - Requires authentication
  - Returns:
    - Total clicks
    - Unique visitors
    - Click statistics by date (last 7 days)
    - OS and device type statistics

- `GET /api/analytics/topic/{topic}`: Get topic-based analytics
  - Requires authentication
  - Returns:
    - Total clicks for topic
    - Unique visitors for topic
    - Click statistics by date
    - Per-URL statistics

- `GET /api/analytics/overall`: Get overall analytics
  - Requires authentication
  - Returns:
    - Total URLs
    - Total clicks
    - Unique visitors
    - Click statistics by date
    - OS and device type statistics

## Rate Limiting

The API implements rate limiting to prevent abuse:
- URL creation: 100 requests per 15 minutes per IP
- Analytics endpoints: 100 requests per 15 minutes per IP

## Caching

- URL mappings are cached in Redis for 24 hours
- Analytics data uses database queries with optimized indexes for performance
- Database schema includes indexes for:
  - User IDs
  - Short codes
  - Analytics data
  - Topic-based queries

## Security Features

- JWT-based authentication
- Google OAuth for secure user authentication
- Rate limiting to prevent abuse
- Secure session management
- Input validation and sanitization
- Helmet middleware for security headers
- CORS protection
- Environment-based security settings

## Error Handling

The API implements comprehensive error handling:
- Validation errors (400)
- Authentication errors (401)
- Rate limiting errors (429)
- Not found errors (404)
- Server errors (500)

## Development

The project uses the following development tools:
- Nodemon for development auto-reload
- Jest for testing
- Supertest for API testing

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Create a Pull Request

## License

MIT License

## Support

For support, please open an issue in the repository. 