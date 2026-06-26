import { lazy } from 'react';

/**
 * Enhanced lazy loader with retry logic and version mismatch recovery.
 * Especially useful for handling 'Failed to fetch dynamically imported module'
 * which often occurs after a new deployment when old chunks are purged.
 */
export const lazyWithRetry = (componentImport) =>
  lazy(async () => {
    try {
      return await componentImport();
    } catch (error) {
      const isChunkError = error.name === 'ChunkLoadError' ||
                          /failed to fetch dynamically imported module/i.test(error.message) ||
                          /error loading dynamically imported module/i.test(error.message);

      if (isChunkError) {
        const lastReload = Number(sessionStorage.getItem('last-chunk-error-reload') || 0);
        const now = Date.now();

        // Prevent infinite reload loops (only reload if last reload was > 10s ago)
        if (now - lastReload > 10000) {
          console.warn('Chunk load error detected, forcing page reload to sync assets...', error);
          sessionStorage.setItem('last-chunk-error-reload', String(now));
          window.location.reload();

          // Return a pending promise to stop the current render cycle
          // while the browser handles the reload.
          return new Promise(() => {});
        }
      }

      // If we already tried reloading recently or it's not a chunk error, bubble it up
      throw error;
    }
  });
