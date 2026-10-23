import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from '@/api/client';
import BasicLayout from '@/layouts/BasicLayout';
import LoginPage from '@/pages/Login';
import PermissionRoute from '@/routes/PermissionRoute';
import { APP_ROUTES } from '@/routes/routes';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { getThemeConfig } from '@/styles/tokens';

export default function App() {
  const profile = useAuthStore((state) => state.profile);
  const loadProfile = useAuthStore((state) => state.loadProfile);
  const mode = useThemeStore((state) => state.mode);
  const fontScale = useThemeStore((state) => state.fontScale);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!getToken()) {
      setReady(true);
      return;
    }
    loadProfile()
      .catch(() => undefined)
      .finally(() => setReady(true));
  }, [loadProfile]);

  // 主题唯一入口：所有页面共享同一份 Antd token
  const themeConfig = useMemo(() => getThemeConfig(mode, fontScale), [mode, fontScale]);

  if (!ready) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 120 }}>
        <Spin size="large" />
      </div>
    );
  }

  return (
    <ConfigProvider locale={zhCN} theme={themeConfig}>
      <Routes>
        <Route path="/login" element={profile ? <Navigate to="/" replace /> : <LoginPage />} />
        <Route element={profile ? <BasicLayout /> : <Navigate to="/login" replace />}>
          {APP_ROUTES.map((route) => (
            <Route
              key={route.path}
              path={route.path}
              element={
                // 路由守卫只是体验层，安全边界在服务端 PermissionsGuard
                <PermissionRoute permissions={route.permissions}>
                  {route.element}
                </PermissionRoute>
              }
            />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
}
