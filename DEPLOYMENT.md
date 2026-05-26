# Deployment Guide: Momentum Engine on Railway

This guide provides a walkthrough for deploying the Momentum Engine monorepo to Railway using the optimized Node.js backend and React/Nginx frontend.

## 1. Quick Start Walkthrough

### 1.1 Push Changes
Ensure all latest changes (including `railway.json` and `Dockerfile`s) are pushed to your GitHub repository.

## 1.2 Monorepo Deployment Strategy (Railway)

Railway treats each service as an independent build unit. Because this is a monorepo, you must manually separate the frontend and backend into their own services:

1.  **Create Services**: In your project dashboard, click **"New"** -> **"GitHub Repo"** -> Select your repository. **Do this twice** (once for Frontend, once for Backend).
2.  **Assign Roles**: Name one service `frontend` and the other `backend`.
3.  **Set Root Directory** (Crucial):
    *   Open the `frontend` service -> **Settings** -> **Build** -> **Root Directory**: Set to `frontend`.
    *   Open the `backend` service -> **Settings** -> **Build** -> **Root Directory**: Set to `backend/node`.
4.  **Watch Paths** (Optional but Recommended):
    *   In the same **Settings** -> **Build** tab, set **Watch Paths** to only trigger builds when files in those directories change:
        *   Frontend: `frontend/**`
        *   Backend: `backend/node/**`

By setting the **Root Directory**, Railway treats that folder as the "project root," allowing it to correctly detect the `Dockerfile` and `package.json` inside each subdirectory without needing a root-level `package.json`.

### 1.3 Add PostgreSQL
1.  In your project dashboard, click **"New"** -> **"Database"** -> **"Add PostgreSQL"**.
2.  Go to the **`backend`** service -> **Variables** tab.
3.  Click **"New Variable"** -> **"Add Reference"** and select `DATABASE_URL` from your Postgres service.

### 1.4 Configure Frontend Variables
1.  Copy the **Public Networking URL** of your `backend` service.
2.  Go to the **`frontend`** service -> **Variables** tab.
3.  Add:
    *   `VITE_API_URL`: Paste the backend URL (e.g., `https://backend-production.up.railway.app`).
    *   `VITE_WS_URL`: Paste the backend URL but change `https://` to `wss://` (e.g., `wss://backend-production.up.railway.app`).
4.  **Re-deploy** the frontend service to bake these variables into the build.

---

## 2. Resource Estimates (Hobby Plan)

The application has been optimized to run efficiently on the Railway $5/month Hobby plan (512MB RAM limit).

| Service | Component | Est. RAM Usage | Est. CPU Usage |
|---------|-----------|----------------|----------------|
| **Backend** | NestJS + TypeORM | 150MB – 250MB | 5% – 15% |
| **Frontend**| Nginx Alpine | 10MB – 20MB | < 1% |
| **Database**| PostgreSQL | ~100MB | < 1% |
| **Total** | | **~260MB – 370MB** | **Low** |

### Key Optimizations:
- **Pruned Dependencies**: Removed unused GraphQL/Apollo packages to reduce memory footprint.
- **Nginx Serving**: Frontend uses Nginx Alpine instead of Node.js, reducing RAM by ~90%.
- **Log Capping**: Session logs are capped at 200 lines to prevent database/memory bloat.
- **Multi-stage Builds**: Docker images are built using Alpine Linux for minimal size and resource overhead.

---

## 3. Environment Variables Reference

### Backend (`backend/node`)
- `DATABASE_URL`: (Automatic via Postgres service)
- `PORT`: 3000 (Default)
- `NODE_ENV`: `production`
- `ALLOWED_ORIGINS`: Comma-separated list of allowed frontend URLs (e.g., `https://your-frontend.up.railway.app`).

### Frontend (`frontend`)
- `VITE_API_URL`: The public URL of the backend.
- `VITE_WS_URL`: The public WebSocket URL of the backend (starts with `wss://`).
