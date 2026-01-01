# Build stage
FROM oven/bun:1 AS build
WORKDIR /app

# Copy package files
COPY package.json bun.lockb* ./
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build frontend
RUN bun run build

# Production stage
FROM oven/bun:1-slim AS production
WORKDIR /app

# Copy built assets and server
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/package.json .

# Install production dependencies only
RUN bun install --production --frozen-lockfile

# Create data directory
RUN mkdir -p /data/communities

# Set environment
ENV NODE_ENV=production
ENV STORAGE_DIR=/data/communities
ENV PORT=3000

# Data volume for persistence
VOLUME /data/communities

EXPOSE 3000

CMD ["bun", "run", "server/index.ts"]
