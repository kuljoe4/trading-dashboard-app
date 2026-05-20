# Build stage
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
# We'll pass the backend URL during build time or handle it via env in the frontend
ARG VITE_WS_URL
ARG VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# Production stage - using Nginx for resource efficiency
FROM nginx:alpine

COPY --from=build /app/dist /usr/share/nginx/html

# Add a basic nginx config if needed, but default is fine for SPA if we add a fallback
RUN echo 'server { \
    listen 80; \
    location / { \
        root /usr/share/nginx/html; \
        index index.html index.htm; \
        try_files $uri $uri/ /index.html; \
    } \
    location /health { \
        access_log off; \
        add_header Content-Type text/plain; \
        return 200 "OK"; \
    } \
}' > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
