# Use Node.js LTS version
FROM node:20-slim

# Install curl for healthcheck
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Create directories for logs and uploads
RUN mkdir -p logs uploads

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Set environment variable
ENV NODE_ENV=production

# Expose port
EXPOSE 3000

# Start the application with explicitly set NODE_ENV that can't be overridden
CMD ["node", "-e", "process.env.NODE_ENV='production'; require('./src/index.js')"] 