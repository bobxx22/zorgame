import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The panel is served by server/main.ts from dist-web; `npm run dev` proxies the API to it.
export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist-web', emptyOutDir: true },
  server: { port: 5180, proxy: { '/api': 'http://127.0.0.1:4747' } },
});
