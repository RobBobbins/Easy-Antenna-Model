import { defineConfig } from 'vite';

// base './' so the built site works from any folder on the web host
export default defineConfig({
  base: './',
  server: { port: 5173, strictPort: true },
});
