import { DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, message } from 'antd';
import type { MenuProps } from 'antd';

const ACTION_LABELS: Record<string, string> = {
  edit: '编辑患者信息',
  glucose: '添加血糖',
  ward: '加入虚拟病区',
  detail: '查看详情',
};

const actionMenu: MenuProps['items'] = [
  { key: 'edit', label: '编辑患者信息' },
  { key: 'glucose', label: '添加血糖' },
  { key: 'ward', label: '加入虚拟病区' },
  { type: 'divider' },
  { key: 'detail', label: '查看详情' },
];

interface PatientMoreActionsProps {
  /** 列表用“更多操作”，卡片用“更多” */
  label?: string;
}

/** 患者列表/卡片共用的占位操作菜单 */
export default function PatientMoreActions({ label = '更多操作' }: PatientMoreActionsProps) {
  return (
    <Dropdown
      trigger={['hover']}
      menu={{
        items: actionMenu,
        onClick: ({ key }) => message.info(`${ACTION_LABELS[key] ?? '该功能'}暂未开发`),
      }}
    >
      <Button type="link" size="small" style={{ paddingInline: 0, height: 'auto' }}>
        {label} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
