import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  root: 'src/web',
  plugins: [react()],
  server: {
    // Temporary: lets the phone reach the dev server on the same Wi-Fi. No sign-in yet, so remove in step 14.
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    proxy: { '/api': `http://localhost:${process.env.API_PORT ?? 8787}` },
  },
  build: { outDir: '../../dist', emptyOutDir: true },
});
