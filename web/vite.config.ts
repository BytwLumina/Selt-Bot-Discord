import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Build thẳng vào src/web-dist để src/web.js phục vụ tại /
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    outDir: '../src/web-dist',
    emptyOutDir: true,
    assetsDir: 'ui',
    target: 'es2020',
    cssCodeSplit: false,
    reportCompressedSize: false,
  },
});
