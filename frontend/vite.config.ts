import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = {
  target: 'http://localhost:8010',
  changeOrigin: true,
  // Server-Sent Events must stream through the proxy without buffering or compression.
  configure: (proxy: { on: (ev: string, fn: (...args: any[]) => void) => void }) => {
    proxy.on('proxyRes', (proxyRes: { headers: Record<string, string> }) => {
      if (String(proxyRes.headers['content-type'] ?? '').includes('text/event-stream')) {
        proxyRes.headers['cache-control'] = 'no-cache, no-transform';
        proxyRes.headers['x-accel-buffering'] = 'no';
      }
    });
  },
};

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: { '/api': api },
  },
  preview: {
    port: 5173,
    strictPort: true,
    host: true,
    allowedHosts: true,
    proxy: { '/api': api },
  },
});
