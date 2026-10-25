# Build stage
FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile || pnpm install

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

# SRE: Custom nginx.conf with generous worker connection pool
RUN cat > /etc/nginx/nginx.conf <<'EOF_CONF'
user nginx;
worker_processes auto;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for"';
    access_log off;
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    include /etc/nginx/conf.d/*.conf;
}
EOF_CONF

RUN cat > /etc/nginx/conf.d/default.conf.template <<'EOF_NGINX'
map $http_upgrade $connection_upgrade {
    default upgrade;
    '' close;
}

server {
    listen ${PORT};
    server_name localhost;
    root /usr/share/nginx/html;
    index index.html;

    access_log off;
    gzip on;
    gzip_types text/css application/javascript application/json image/svg+xml;
    gzip_min_length 1024;

    # SRE: Increase proxy buffer sizes to prevent 'upstream sent too big header' (HTTP 502)
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
    proxy_temp_file_write_size 256k;

    # SRE P0: WebSocket endpoint — dedicated 24h timeouts, connection upgrade, and backend SNI
    location = /session/ws {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host ${BACKEND_HOST};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;
        proxy_ssl_name ${BACKEND_HOST};
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_connect_timeout 10s;
    }

    # SRE P0: REST API endpoints — set Host: ${BACKEND_HOST} to avoid routing loop on Railway public edge
    location ~ ^/(session|presets|auth|settings|monitoring|healthz|startup-checklist) {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host ${BACKEND_HOST};
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_ssl_server_name on;
        proxy_ssl_name ${BACKEND_HOST};
        proxy_read_timeout 60s;
        proxy_send_timeout 60s;
        proxy_connect_timeout 10s;
    }

    # SRE: Exact match for local frontend health check
    location = /health {
        access_log off;
        add_header Content-Type application/json;
        return 200 '{"status":"ok","service":"frontend","message":"Frontend is healthy."}';
    }

    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF_NGINX

EXPOSE 80

CMD ["/bin/sh", "-c", "\
: ${PORT:=80}; \
: ${BACKEND_URL:=${API_URL:-${VITE_API_URL:-http://localhost:8080}}}; \
BACKEND_URL=$(echo \"${BACKEND_URL}\" | sed 's:/*$::'); \
BACKEND_HOST=$(echo \"${BACKEND_URL}\" | sed -E 's|^https?://||' | sed -E 's|(:[0-9]+)?(/.*)?$||'); \
if [ -n \"${RAILWAY_STATIC_URL}\" ] && [ \"${BACKEND_HOST}\" = \"${RAILWAY_STATIC_URL}\" ]; then \
  echo '[FATAL] BACKEND_URL host matches RAILWAY_STATIC_URL ('${BACKEND_HOST}'). This triggers an infinite routing loop.'; \
  echo '[FATAL] Set BACKEND_URL to Railway private networking (e.g. http://<backend-service>.railway.internal:8080) or the backend service domain.'; \
  exit 1; \
fi; \
echo \"[Nginx Startup] Forwarding API traffic to ${BACKEND_URL} (Host: ${BACKEND_HOST}) on port ${PORT}\"; \
export PORT BACKEND_URL BACKEND_HOST; \
envsubst '${PORT} ${BACKEND_URL} ${BACKEND_HOST}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && \
nginx -g 'daemon off;' \
"]
