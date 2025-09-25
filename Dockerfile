FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm install

# Copy source code
COPY . .

# Build the TypeScript code
RUN npm run build

# Remove dev dependencies to keep image size small
RUN npm prune --omit=dev

# Create non-root user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S audioconnector -u 1001

# Change ownership of the app directory
RUN chown -R audioconnector:nodejs /app
USER audioconnector

# Expose port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:8080/health', (res) => { process.exit(res.statusCode === 200 ? 0 : 1) })" || exit 1

# Start the application
CMD ["node", "dist/index.js"]