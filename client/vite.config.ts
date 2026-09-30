import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_API_PROXY_TARGET || 'http://localhost:8787';
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port: Number(env.VITE_PORT || 5173),
      strictPort: true,
      host: true, // localhost가 127.0.0.1로 풀리는 브라우저에서도 열리게 (IPv4·IPv6 모두)
      proxy: {
        '/api': { target: api, changeOrigin: true },
        '/ws': { target: api, ws: true, changeOrigin: true },
      },
    },
  };
});
