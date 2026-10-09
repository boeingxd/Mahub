import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Use http://127.0.0.1:5173, not localhost: after visiting https://localhost,
    // the browser's HSTS rule forces https on every localhost port for a while,
    // which breaks Vite's plain-http dev server. IP addresses are exempt.
    host: '127.0.0.1',
    proxy: {
      // During `npm run dev`, send API calls to the real stack behind Caddy.
      // secure: false accepts Caddy's local certificate.
      '/api': { target: 'https://localhost', changeOrigin: true, secure: false },
    },
  },
});
