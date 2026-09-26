import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // GitHub Pages hosts this project below the repository name.
  // Keep the dev server at / for local play and the Cloudflare tunnel.
  base: command === 'build' ? '/plinko-incremental/' : '/',
}));
