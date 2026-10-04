import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${process.env.API_PORT ?? 8787}` },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
