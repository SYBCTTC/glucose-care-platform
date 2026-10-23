import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Button, Card, Form, Input, Typography, message } from 'antd';
import { ERROR_CODES, loginSchema } from '@gc/shared';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm<{ username: string; password: string }>();
  const login = useAuthStore((state) => state.login);

  const handleSubmit = async (values: { username: string; password: string }) => {
    try {
      // 复用共享 schema 做前端预校验，后端仍会再次校验
      loginSchema.parse(values);
      await login(values.username, values.password);
      message.success('登录成功');
      // 会话失效跳转时会带 redirect，登录后回跳原页面
      const redirect = searchParams.get('redirect');
      navigate(redirect && redirect.startsWith('/') ? redirect : '/inpatient/patients', { replace: true });
    } catch (error) {
      if (error instanceof ApiError) {
        // 字段级错误（20001 用户名或密码错误 / 20006 密码强度 / 20007 当前密码错误）
        // 不弹全局提示，直接挂到表单项上
        const field = error.code === ERROR_CODES.INVALID_CREDENTIALS ? 'password' : 'username';
        form.setFields([{ name: field, errors: [error.message] }]);
        return;
      }
      message.error(error instanceof Error ? error.message : '登录失败');
    }
  };

  return (
    <div className="gc-login-layout">
      <Card
        className="gc-login-card"
        style={{ width: 380 }}
        styles={{ body: { padding: 0 } }}
        title={
          <div style={{ paddingTop: 8 }}>
            <div style={{ fontSize: 'var(--gc-font-lg)', fontWeight: 600 }}>设备与人员管理平台</div>
            <Typography.Text type="secondary" style={{ fontSize: 'var(--gc-font-xs)' }}>
              院内设备与人员统一管理
            </Typography.Text>
          </div>
        }
      >
        <div className="gc-login-brand" />
        <div style={{ padding: 'var(--gc-space-lg)' }}>
          <Typography.Paragraph type="secondary" style={{ marginBottom: 'var(--gc-space-md)' }}>
            请使用院内统一分配的账号登录。所有访问行为均会被审计记录。
          </Typography.Paragraph>
          <Form form={form} onFinish={handleSubmit} size="large">
            <Form.Item name="username" rules={[{ required: true, message: '请输入用户名' }]}>
              <Input prefix={<UserOutlined />} placeholder="用户名" autoComplete="username" />
            </Form.Item>
            <Form.Item name="password" rules={[{ required: true, message: '请输入密码' }]}>
              <Input.Password prefix={<LockOutlined />} placeholder="密码" autoComplete="current-password" />
            </Form.Item>
            <Button type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form>
        </div>
      </Card>
    </div>
  );
}
