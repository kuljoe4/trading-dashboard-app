# Build stage
FROM node:22-alpine AS build

WORKDIR /app
ENV NODE_ENV=development
RUN corepack enable && corepack prepare pnpm@10 --activate

COPY package.json pnpm-lock.yaml* ./
RUN pnpm install

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

    # SRE: Increase proxy buffer sizes to prevent 'upstream sent too big header while reading response header' (HTTP 502)
    proxy_buffer_size 128k;
    proxy_buffers 4 256k;
    proxy_busy_buffers_size 256k;
    proxy_temp_file_write_size 256k;

    # Backend proxy rules for same-origin routing to avoid CORS and WS-origin issues
    location /presets {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /session {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /auth {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /settings {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /monitoring {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /healthz {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /startup-checklist {
        proxy_pass ${BACKEND_URL};
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffer_size 128k;
        proxy_buffers 4 256k;
        proxy_busy_buffers_size 256k;
    }

    location /health {
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

CMD ["/bin/sh", "-c", ": ${PORT:=80}; : ${BACKEND_URL:=${API_URL:-${VITE_API_URL:-http://localhost:8080}}}; BACKEND_URL=$(echo \"${BACKEND_URL}\" | sed 's:/*$::'); export PORT BACKEND_URL; envsubst '${PORT} ${BACKEND_URL}' < /etc/nginx/conf.d/default.conf.template > /etc/nginx/conf.d/default.conf && sed -i 's/^worker_processes.*/worker_processes 2;/' /etc/nginx/nginx.conf && sed -i 's/worker_connections.*/worker_connections 4096;/' /etc/nginx/nginx.conf && nginx -g 'daemon off;'"]
