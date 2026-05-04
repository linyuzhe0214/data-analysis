import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  const gasUrl = env.VITE_GAS_URL || '';

  // GAS URL 拆解：取 origin + path，供 proxy 用
  let gasOrigin = '';
  let gasPath = '';
  try {
    const u = new URL(gasUrl);
    gasOrigin = u.origin;
    gasPath   = u.pathname;
  } catch (_) {}

  return {
    base: env.VITE_BASE_PATH || '/',
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      // 本機開發時把 /api/gas 轉發到 GAS，避免 CORS
      proxy: gasOrigin ? {
        '/api/gas': {
          target: gasOrigin,
          changeOrigin: true,
          rewrite: () => gasPath,
          followRedirects: true,
        },
      } : {},
    },
  };
});
