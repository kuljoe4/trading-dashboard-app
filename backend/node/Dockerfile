# Build stage
FROM node:20-alpine AS build

WORKDIR /app
ENV NODE_ENV=development

COPY package*.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

# Production dependencies only
FROM node:20-alpine AS deps

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev --ignore-scripts \
  && npm cache clean --force

# Runtime stage
FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production \
    NODE_OPTIONS=--max-old-space-size=512 \
    KLINE_MAX_CANDLES=200

COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package*.json ./

USER node
EXPOSE 3000

CMD ["node", "dist/server.js"]
