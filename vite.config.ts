import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web page lives in web/ and builds into dist/web, which the server serves.
// In development, API and live-update traffic is forwarded to the server on 8080.
export default defineConfig({
  root: 'web',
  plugins: [react()],
  build: { outDir: '../dist/web', emptyOutDir: true },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/socket.io': { target: 'http://localhost:8080', ws: true },
    },
  },
});
