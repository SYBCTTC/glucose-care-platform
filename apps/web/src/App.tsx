import { ConfigProvider, Spin } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { getToken } from '@/api/client';
import BasicLayout from '@/layouts/BasicLayout';
import LoginPage from '@/pages/Login';
import PermissionRoute from '@/routes/PermissionRoute';
import type { AppRoute } from '@/routes/menu';
import { APP_ROUTES } from '@/routes/routes';
import { useAuthStore } from '@/store/auth';
import { useThemeStore } from '@/store/theme';
import { getThemeConfig } from '@/styles/tokens';

/**
 * 递归渲染路由表。
 *
 * 抽成函数是因为 `AppRoute` 支持 `children`（患者详情页的 5 个内容页），顶层 map 表达不了嵌套。
 * 两点约定：
 *  - `index` 路由渲染 `<Route index/>`，且**不能带 children**（React Router 会直接抛错）；
 *  - 子路由同样包一层 `PermissionRoute`：它们按约定不声明 `permissions`，
 *    而该组件在 permissions 为空时直接放行，故无额外开销。真正的守卫来自父级——
 *    子路由渲染在父 `element` 的 `<Outlet/>` 内，父级判 403 时 `Outlet` 根本不渲染。
 */
function renderRoutes(routes: AppRoute[]): ReactNode {
  return routes.map((route) => {
    // 路由守卫只是体验层，安全边界在服务端 PermissionsGuard
    const element = (
      <PermissionRoute permissions={route.permissions}>{route.element}</PermissionRoute>
    );
    if (route.index) {
      return <Route key="index" index element={element} />;
    }
    return (
      <Route key={route.path} path={route.path} element={element}>
        {route.children ? renderRoutes(route.children) : null}
      </Route>
    );
  });
}

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
          {renderRoutes(APP_ROUTES)}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ConfigProvider>
  );
}
