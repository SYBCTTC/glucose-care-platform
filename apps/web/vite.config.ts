import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
// 用 vitest/config 的 defineConfig，才能带 test 字段且类型完整
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      // 开发环境走代理，生产由 Nginx 反向代理到 Nest 服务
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    // 内网交付：所有依赖必须打包进产物，禁止运行时从公网 CDN 加载
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          antd: ['antd', '@ant-design/icons'],
          charts: ['echarts', 'echarts-for-react'],
        },
      },
    },
  },
  test: {
    // node 环境 + renderToStaticMarkup 断言（本机守卫拦截了 jsdom 安装）；
    // 装好 jsdom 后可改 environment: 'jsdom' 并使用 RTL
    include: ['src/**/*.spec.{ts,tsx}'],
    setupFiles: ['./src/test-setup.ts'],
  },
});