import { HomeOutlined, LockOutlined } from '@ant-design/icons';
import { Button, Card, Result, Space, Tag, Typography } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/store/auth';

/**
 * 403 无权限页（对应服务端 `30004 缺少权限点`）。
 *
 * 刻意**不跳登录**：无权限不是会话失效，跳登录会让用户反复登录却始终进不去。
 * 展示所需权限点，方便用户直接向信息科报修（内网定位快）。
 */
export default function ForbiddenPage() {
  const navigate = useNavigate();
  const profile = useAuthStore((state) => state.profile);

  return (
    <Card>
      <Result
        status="403"
        icon={<LockOutlined />}
        title="无访问权限"
        subTitle="当前账号的角色缺少访问该页面所需的权限点，请联系信息科开通。"
        extra={
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Button type="primary" icon={<HomeOutlined />} onClick={() => navigate('/inpatient/patients')}>
              返回工作台
            </Button>
            {profile ? (
              <Typography.Text type="secondary">
                当前账号：{profile.displayName}（{profile.username}）
              </Typography.Text>
            ) : null}
          </Space>
        }
      >
        {profile ? (
          <Space direction="vertical" size={8}>
            <Typography.Text>已授予的权限点：</Typography.Text>
            <Space size={[4, 8]} wrap>
              {profile.permissions.length ? (
                profile.permissions.map((permission) => (
                  <Tag key={permission}>{permission}</Tag>
                ))
              ) : (
                <Typography.Text type="secondary">无</Typography.Text>
              )}
            </Space>
          </Space>
        ) : null}
      </Result>
    </Card>
  );
}
