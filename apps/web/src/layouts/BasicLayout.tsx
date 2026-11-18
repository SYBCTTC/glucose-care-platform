import { BulbFilled, BulbOutlined, FontSizeOutlined } from '@ant-design/icons';
import { Avatar, Button, Layout, Menu, Space, Switch, Tag, Tooltip, Typography, message } from 'antd';
import type { MenuProps } from 'antd';
import { useEffect, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DATA_SCOPE_LABELS } from '@gc/shared';
import { FORCE_PASSWORD_EVENT, REFRESH_PROFILE_EVENT } from '@/api/error-handler';
import ChangePasswordModal from '@/components/ChangePasswordModal';
import ProfileModal from '@/components/ProfileModal';
import { APP_ROUTES, buildMenuTree } from '@/routes/routes';
import { useAuthStore } from '@/store/auth';
import { useCommonDataStore } from '@/store/common-data';
import { useThemeStore } from '@/store/theme';
import { layoutSize } from '@/styles/tokens';

const { Header, Sider, Content } = Layout;

/** 等保要求：会话空闲超时（分钟），与后端 JWT_EXPIRES_IN 保持一致 */
const IDLE_TIMEOUT_MINUTES = 30;

export default function BasicLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useAuthStore((state) => state.profile);
  const logout = useAuthStore((state) => state.logout);
  const loadProfile = useAuthStore((state) => state.loadProfile);
  const hasPermission = useAuthStore((state) => state.hasPermission);
  const mode = useThemeStore((state) => state.mode);
  const fontScale = useThemeStore((state) => state.fontScale);
  const toggleMode = useThemeStore((state) => state.toggleMode);
  const toggleFontScale = useThemeStore((state) => state.toggleFontScale);
  const [collapsed, setCollapsed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [forceChangeOpen, setForceChangeOpen] = useState(false);
  const idleTimer = useRef<number | null>(null);
  const loadCommonData = useCommonDataStore((state) => state.load);

  /** 登录后一次性加载公共数据（科室/人员/设备），存入 store 供后续复用，不重复请求 */
  useEffect(() => {
    void loadCommonData().catch(() => undefined);
  }, [loadCommonData]);

  /** 首次登录/被重置后强制改密：服务端同时会拒绝其他接口（20005），前端弹窗不可关闭 */
  useEffect(() => {
    setForceChangeOpen(Boolean(profile?.mustChangePassword));
  }, [profile?.mustChangePassword]);

  useEffect(() => {
    const force = () => setForceChangeOpen(true);
    window.addEventListener(FORCE_PASSWORD_EVENT, force);
    return () => window.removeEventListener(FORCE_PASSWORD_EVENT, force);
  }, []);

  /**
   * 收到 30004/30002 时重拉一次权限再提示：
   * 可能是管理员刚改了角色，客户端拿的是旧权限集合（规则 permissions.md 要求）。
   */
  useEffect(() => {
    const refresh = () => {
      void loadProfile().catch(() => undefined);
    };
    window.addEventListener(REFRESH_PROFILE_EVENT, refresh);
    return () => window.removeEventListener(REFRESH_PROFILE_EVENT, refresh);
  }, [loadProfile]);

  /** 改密成功后一律退出到登录页，用新密码重新登录 */
  const handlePasswordChanged = () => {
    void logout().then(() => navigate('/login', { replace: true }));
  };

  // 空闲超时自动登出
  useEffect(() => {
    const reset = () => {
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
      }
      idleTimer.current = window.setTimeout(() => {
        void logout().then(() => {
          message.warning(`已超过 ${IDLE_TIMEOUT_MINUTES} 分钟无操作，请重新登录`);
          navigate('/login', { replace: true });
        });
      }, IDLE_TIMEOUT_MINUTES * 60 * 1000);
    };
    const events: (keyof WindowEventMap)[] = ['mousemove', 'keydown', 'click'];
    events.forEach((event) => window.addEventListener(event, reset));
    reset();
    return () => {
      events.forEach((event) => window.removeEventListener(event, reset));
      if (idleTimer.current) {
        window.clearTimeout(idleTimer.current);
      }
    };
  }, [logout, navigate]);

  // 菜单与路由守卫同源：同一份 APP_ROUTES 构建嵌套树，避免"菜单藏了、路由没守"的越权入口
  const { items: menuItems, openKeys } = buildMenuTree(APP_ROUTES, hasPermission);

  return (
    <Layout style={{ minHeight: '100%' }}>
      <Sider
        collapsible
        collapsed={collapsed}
        onCollapse={setCollapsed}
        width={layoutSize.siderWidth}
        collapsedWidth={layoutSize.siderCollapsedWidth}
        style={{ minHeight: '100%' }}
      >
        <div
          style={{
            height: layoutSize.headerHeight,
            display: 'flex',
            alignItems: 'center',
            padding: '0 16px',
            color: mode === 'dark' ? '#ffffff' : '#08333a',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
          }}
        >
          设备与人员管理平台
        </div>
        <Menu
          theme={mode === 'dark' ? 'dark' : 'light'}
          mode="inline"
          selectedKeys={[
            // 患者详情 /inpatient/patients/:id 不在菜单中，高亮其父级"患者管理"
            location.pathname.startsWith('/inpatient/patients/')
              ? '/inpatient/patients'
              : location.pathname,
          ]}
          defaultOpenKeys={openKeys}
          items={menuItems as MenuProps['items']}
          onClick={({ key }) => {
            // 仅 path 类型节点可导航；分组节点（group:/mid: 前缀）只负责展开
            if (key.startsWith('/')) {
              navigate(key);
            }
          }}
        />
      </Sider>
      <Layout>
        <Header
          className="gc-no-print"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        >
          <Typography.Text type="secondary">院内设备与人员管理</Typography.Text>
          <Space size={4}>
            <Tooltip title={fontScale === 'large' ? '切换为标准字号' : '切换为大字号（适老）'}>
              <Button
                type="text"
                icon={<FontSizeOutlined />}
                onClick={toggleFontScale}
                aria-label="切换字号"
              >
                {fontScale === 'large' ? '大' : '标准'}
              </Button>
            </Tooltip>
            <Tooltip title={mode === 'dark' ? '切换为浅色模式' : '切换为暗色模式'}>
              <Switch
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                checked={mode === 'dark'}
                onChange={toggleMode}
                aria-label="切换明暗模式"
              />
            </Tooltip>
            <Button
              type="text"
              onClick={() => setProfileOpen(true)}
              style={{ paddingInline: 4 }}
              aria-label="查看个人资料"
            >
              <Space size={8}>
                <Avatar
                  style={{
                    backgroundColor: 'var(--gc-color-primary-active)',
                    color: 'var(--gc-color-primary-ink)',
                  }}
                >
                  {profile?.displayName?.slice(0, 1) ?? '-'}
                </Avatar>
                <span>{profile?.displayName}</span>
              </Space>
            </Button>
            <Typography.Text type="secondary">{profile?.departmentName}</Typography.Text>
            {profile?.dataScope ? (
              <Tooltip title="数据可见范围由角色决定，服务端强制过滤，前端展示仅供参考">
                <Tag style={{ marginInlineEnd: 0 }}>
                  {DATA_SCOPE_LABELS?.[profile.dataScope] ?? profile.dataScope}
                </Tag>
              </Tooltip>
            ) : null}
            <Button
              size="small"
              onClick={() => {
                void logout().then(() => navigate('/login', { replace: true }));
              }}
            >
              退出登录
            </Button>
          </Space>
        </Header>
        <Content style={{ margin: layoutSize.contentPadding, minWidth: layoutSize.contentMinWidth }}>
          <Outlet />
        </Content>
      </Layout>

      {profile ? (
        <>
          <ProfileModal
            open={profileOpen}
            profile={profile}
            onClose={() => setProfileOpen(false)}
            onPasswordChanged={handlePasswordChanged}
          />
          <ChangePasswordModal
            open={forceChangeOpen}
            forced
            onQuit={handlePasswordChanged}
            onSuccess={handlePasswordChanged}
          />
        </>
      ) : null}
    </Layout>
  );
}
