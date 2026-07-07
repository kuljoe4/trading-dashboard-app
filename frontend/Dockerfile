# Build stage
FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
ARG VITE_WS_URL
ARG VITE_API_URL
# ARG VITE_ADMIN_API_KEY (SEC-01: Removed from build-time args to prevent embedding in bundle)
ENV VITE_WS_URL=$VITE_WS_URL \
    VITE_API_URL=$VITE_API_URL

RUN pnpm run build

# Production stage - static nginx footprint is materially smaller than a Node server
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

RUN cat > /etc/nginx/conf.d/default.conf.template <<'EOF_NGINX'
server {
    listen ${PORT};
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    access_log off;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location /health {
        access_log off;
        add_header Content-Type text/plain;
        return 200 "OK";
    }
}
EOF_NGINX

EXPOSE 80

CMD ["/bin/sh", "-c", ": ${PORT:=80}; envsubst '${PORT}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && sed -i 's/^worker_processes.*/worker_processes 1;/' /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
