import { Button, Descriptions, Modal, Space, Tag, Tooltip } from 'antd';
import { DATA_SCOPE_LABELS, ROLE_LABELS } from '@gc/shared';
import type { Profile } from '@/store/auth';
import ChangePasswordModal from './ChangePasswordModal';
import { useState } from 'react';

interface Props {
  open: boolean;
  profile: Profile;
  onClose: () => void;
  /** 改密成功：由外层负责登出并跳登录页 */
  onPasswordChanged: () => void;
}

/** 个人资料（点击右上角姓名打开）：基础信息 + 修改密码入口 */
export default function ProfileModal({ open, profile, onClose, onPasswordChanged }: Props) {
  const [changeOpen, setChangeOpen] = useState(false);

  return (
    <>
      <Modal open={open} title="个人资料" onCancel={onClose} footer={null} destroyOnClose>
        <Descriptions column={1} size="middle" bordered>
          <Descriptions.Item label="姓名">{profile.displayName}</Descriptions.Item>
          <Descriptions.Item label="账号">{profile.username}</Descriptions.Item>
          <Descriptions.Item label="科室">{profile.departmentName ?? '-'}</Descriptions.Item>
          <Descriptions.Item label="人员类型">
            <Space size={4}>
              {profile.roles.map((role) => (
                <Tag key={role}>{ROLE_LABELS?.[role] ?? role}</Tag>
              ))}
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label="数据范围">
            <Tooltip title="数据可见范围由角色决定，服务端强制过滤，此处仅作提示">
              <Tag>{DATA_SCOPE_LABELS?.[profile.dataScope] ?? profile.dataScope}</Tag>
            </Tooltip>
          </Descriptions.Item>
          <Descriptions.Item label="最近登录">
            {profile.lastLoginAt ?? '从未登录'}
          </Descriptions.Item>
        </Descriptions>
        <div style={{ marginTop: 16, textAlign: 'right' }}>
          <Button type="primary" onClick={() => setChangeOpen(true)}>
            修改密码
          </Button>
        </div>
      </Modal>

      <ChangePasswordModal
        open={changeOpen}
        onCancel={() => setChangeOpen(false)}
        onSuccess={() => {
          setChangeOpen(false);
          onPasswordChanged();
        }}
      />
    </>
  );
}
