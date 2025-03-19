# Use Node.js LTS version
FROM node:20-slim

# Set environment variable in multiple ways to ensure it's set
ENV NODE_ENV=production
# RUN echo "export NODE_ENV=production" >> /etc/profile
# RUN echo "export NODE_ENV=production" >> /etc/bash.bashrc
# RUN echo "NODE_ENV=production" >> /etc/environment

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

# Expose port
EXPOSE 3000

# Start the application with a wrapper script to ensure NODE_ENV is set
# COPY <<-EOT /usr/local/bin/start.sh
# #!/bin/sh
# export NODE_ENV=production
# exec node src/index.js
# EOT

# RUN chmod +x /usr/local/bin/start.sh

# Use the wrapper script to start the application
CMD ["npm", "start"] 