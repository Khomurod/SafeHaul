import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'url';
import path, { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5000,
    strictPort: true, // CRITICAL: Fail if port 5000 is in use, don't silently switch to 5001
    allowedHosts: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@app': path.resolve(__dirname, './src/app'),
      '@features': path.resolve(__dirname, './src/features'),
      '@shared': path.resolve(__dirname, './src/shared'),
      '@design-system': path.resolve(__dirname, './src/design-system'),
      '@lib': path.resolve(__dirname, './src/lib'),
    },
  },
  optimizeDeps: {
    exclude: [
      'firebase/app',
      'firebase/auth',
      'firebase/firestore',
      'firebase/functions',
      'firebase/storage',
      'firebase/app-check'
    ],
    include: ['pdfjs-dist'],
    esbuildOptions: {
      target: 'esnext', // CRITICAL: Allows Top-Level Await for PDF.js
    },
  },
  build: {
    target: 'esnext', // CRITICAL: Ensures production build supports modern JS features
    // E1 FIX: Emit HIDDEN sourcemaps — full maps are generated for upload to Sentry, but no
    // //# sourceMappingURL comment ships in the bundle, so maps are never publicly served.
    // CI uploads them to Sentry then strips *.map from the deploy artifact (see main.yml).
    sourcemap: 'hidden',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
      },
      output: {
        manualChunks: {
          pdfjs: ['pdfjs-dist']
        }
      }
    }
  }
})
