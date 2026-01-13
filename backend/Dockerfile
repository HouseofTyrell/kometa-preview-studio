# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source
COPY . .

# Build
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Install Docker CLI for container management
RUN apk add --no-cache docker-cli

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --production

# Copy built files from builder
COPY --from=builder /app/dist ./dist

# Create jobs directory
RUN mkdir -p /app/jobs

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3001
ENV HOST=0.0.0.0

# Expose port
EXPOSE 3001

# Start the server
CMD ["node", "dist/index.js"]
