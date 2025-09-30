# syntax=docker/dockerfile:1

FROM node:20-slim

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application files
COPY scraper.js mcp-server.js ./

# Expose default port for HTTP mode
EXPOSE 3000

# Set default command to run MCP server in HTTP mode
CMD ["node", "mcp-server.js", "http", "3000"]