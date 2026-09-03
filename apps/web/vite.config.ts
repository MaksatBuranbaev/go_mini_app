import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: {
    // WebView Telegram на Android бывает заметно старее десктопного браузера.
    target: 'es2020',
  },
  server: {
    // Разработка идёт через HTTPS-туннель cloudflared: Telegram открывает
    // мини-апп только по https, а туннель приходит с чужим Host.
    host: true,
    allowedHosts: true,
  },
});
