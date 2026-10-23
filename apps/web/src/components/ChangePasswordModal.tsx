import { LockOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Typography, message } from 'antd';
import { ERROR_CODES, PASSWORD_RULE_TEXT, changePasswordSchema } from '@gc/shared';
import { ApiError } from '@/api/client';
import { useAuthStore } from '@/store/auth';

interface FormValues {
  oldPassword: string;
  newPassword: string;
  confirmPassword: string;
}

/** 后端 details.field → 表单项（只接受已知字段，避免脏数据写坏表单） */
const FIELD_MAP: Record<string, keyof FormValues> = {
  oldPassword: 'oldPassword',
  newPassword: 'newPassword',
  confirmPassword: 'confirmPassword',
};

interface Props {
  open: boolean;
  /** 强制修改（首次登录）：不可关闭，出口只有改密或退出登录 */
  forced?: boolean;
  onCancel?: () => void;
  onSuccess: () => void;
  /** 强制模式下的"退出登录" */
  onQuit?: () => void;
}

/**
 * 修改密码弹窗。
 * 强制模式下没有关闭按钮、不可点遮罩、不接受 ESC，避免用户绕过首次改密。
 */
export default function ChangePasswordModal({ open, forced = false, onCancel, onSuccess, onQuit }: Props) {
  const [form] = Form.useForm<FormValues>();
  const changePassword = useAuthStore((state) => state.changePassword);

  const submit = async (values: FormValues) => {
    try {
      await changePassword(values.oldPassword, values.newPassword);
      message.success('密码修改成功，请使用新密码重新登录');
      onSuccess();
    } catch (error) {
      if (!(error instanceof ApiError)) {
        return;
      }
      // 字段级错误挂到对应表单项，不弹全局提示
      const knownFields = (error.details ?? [])
        .filter((item) => item.field in FIELD_MAP)
        .map((item) => ({
          name: FIELD_MAP[item.field] as keyof FormValues,
          errors: [item.message],
        }));
      if (knownFields.length) {
        form.setFields(knownFields);
        return;
      }
      const target =
        error.code === ERROR_CODES.WRONG_CURRENT_PASSWORD
          ? 'oldPassword'
          : error.code === ERROR_CODES.WEAK_PASSWORD || error.code === ERROR_CODES.PASSWORD_REUSE
            ? 'newPassword'
            : null;
      if (target) {
        form.setFields([{ name: target, errors: [error.message] }]);
      }
    }
  };

  return (
    <Modal
      open={open}
      title={forced ? '首次登录，请先修改密码' : '修改密码'}
      okText="确认修改"
      cancelText="取消"
      maskClosable={!forced}
      keyboard={!forced}
      closable={!forced}
      onCancel={onCancel}
      onOk={() => form.submit()}
      footer={
        forced
          ? [
              <Button key="quit" onClick={onQuit}>
                退出登录
              </Button>,
              <Button key="submit" type="primary" onClick={() => form.submit()}>
                确认修改
              </Button>,
            ]
          : undefined
      }
      destroyOnClose
    >
      {forced ? (
        <Alert
          type="warning"
          showIcon
          message="为保障账号安全，首次登录必须修改密码后才能使用系统功能。"
          style={{ marginBottom: 16 }}
        />
      ) : null}
      <Form
        form={form}
        layout="vertical"
        preserve={false}
        onFinish={submit}
        validateTrigger={['onBlur']}
      >
        <Form.Item
          name="oldPassword"
          label="原密码"
          rules={[{ required: true, message: '请输入原密码' }]}
        >
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          extra={<Typography.Text type="secondary">{PASSWORD_RULE_TEXT}</Typography.Text>}
          rules={[
            { required: true, message: '请输入新密码' },
            {
              validator: (_rule, value: string) => {
                if (!value) {
                  return Promise.resolve();
                }
                const result = changePasswordSchema.safeParse({
                  oldPassword: 'x',
                  newPassword: value,
                  confirmPassword: value,
                });
                if (result.success) {
                  return Promise.resolve();
                }
                return Promise.reject(new Error(result.error.issues[0]?.message ?? '密码不符合要求'));
              },
            },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator: (_rule, value: string) =>
                !value || value === getFieldValue('newPassword')
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致')),
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
      </Form>
    </Modal>
  );
}
