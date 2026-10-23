import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import dayjs from 'dayjs';
import 'dayjs/locale/zh-cn';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { applyDocumentTheme, useThemeStore } from './store/theme';
import './styles/global.css';

// 日期组件的月份/星期文案来自 dayjs，必须在渲染前切换为中文
dayjs.locale('zh-cn');

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      // 患者数据不做长时间缓存，避免切换账号后残留上一位用户的视图数据
      staleTime: 30_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) {
  throw new Error('未找到 #root 挂载节点');
}

// 首帧前落地主题，避免暗色模式闪白
const { mode, fontScale } = useThemeStore.getState();
applyDocumentTheme(mode, fontScale);

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
