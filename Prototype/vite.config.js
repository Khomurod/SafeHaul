import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  appType: 'mpa',
  server: {
    port: 4184,
    open: false
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        production: resolve(__dirname, 'production/index.html'),
        v1: resolve(__dirname, 'v1/index.html'),
        v2: resolve(__dirname, 'v2/index.html'),
        v3: resolve(__dirname, 'v3/index.html'),
        v4: resolve(__dirname, 'v4/index.html'),
      }
    }
  }
});
