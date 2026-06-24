# Shipment Tracking System — runtime image
# Node 20 (CommonJS). App listens on PORT (8080) and mounts under BASE_PATH (/tracking).
FROM node:20-alpine

WORKDIR /app

# Install deps first for better layer caching
COPY package*.json ./
RUN npm ci --omit=dev

# App source (server/, public/, etc. — built by other agents)
COPY . .

# Run as non-root user (built-in 'node' user on node:*-alpine images)
USER node

# Express listens here (inside the container)
EXPOSE 8080

# Container health check — hits the app's own root under BASE_PATH.
# node:20-alpine ships neither curl nor wget, so use a tiny node one-liner.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 --start-period=20s \
  CMD node -e "require('http').get('http://localhost:8080/tracking/',r=>process.exit(r.statusCode===200?0:1))"

CMD ["node", "server/index.js"]
