# ========================================
# MERN Frontend - Dockerfile
# ========================================
# Development Dockerfile for React client

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files first (Docker layer caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source code
COPY . .

# Expose the React dev server port
EXPOSE 3000

# Enable polling for file watching inside Docker
ENV CHOKIDAR_USEPOLLING=true

# Start the React development server
CMD ["npm", "start"]
