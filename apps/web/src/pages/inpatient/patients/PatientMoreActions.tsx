import { useMemo } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import type { PatientListItem } from '@gc/shared';

const ACTION_LABELS: Record<string, string> = {
  edit: '编辑患者信息',
  glucose: '添加血糖',
  ward: '加入虚拟病区',
  detail: '查看详情',
};

interface PatientMoreActionsProps {
  patient: PatientListItem;
  /** 列表用「更多操作」，卡片用「更多」 */
  label?: string;
  /** 是否有患者编辑权限：无权限时「编辑患者信息」整项不展示 */
  canEdit: boolean;
  /** 置灰原因（出院患者传值）：有值时编辑项置灰并提示，不隐藏 */
  editDisabledReason?: string;
  /** 是否有添加血糖权限：无权限时整项不展示（出院患者也不展示） */
  canCreateGlucose?: boolean;
  onEdit: (patient: PatientListItem) => void;
  onAddGlucose?: (patient: PatientListItem) => void;
}

/** 患者列表/卡片共用的操作菜单 */
export default function PatientMoreActions({
  patient,
  label = '更多操作',
  canEdit,
  editDisabledReason,
  canCreateGlucose = false,
  onEdit,
  onAddGlucose,
}: PatientMoreActionsProps) {
  const items = useMemo<NonNullable<MenuProps['items']>>(() => {
    const result: NonNullable<MenuProps['items']> = [];
    if (canEdit) {
      result.push({
        key: 'edit',
        disabled: Boolean(editDisabledReason),
        label: editDisabledReason ? (
          <Tooltip title={editDisabledReason}>
            <span>{ACTION_LABELS.edit}</span>
          </Tooltip>
        ) : (
          ACTION_LABELS.edit
        ),
      });
    }
    if (canCreateGlucose) {
      result.push({ key: 'glucose', label: ACTION_LABELS.glucose });
    }
    result.push(
      { key: 'ward', label: ACTION_LABELS.ward },
      { type: 'divider' },
      { key: 'detail', label: ACTION_LABELS.detail },
    );
    return result;
  }, [canEdit, editDisabledReason, canCreateGlucose]);

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') {
      onEdit(patient);
      return;
    }
    if (key === 'glucose') {
      onAddGlucose?.(patient);
      return;
    }
    message.info(`${ACTION_LABELS[key] ?? '该功能'}暂未开发`);
  };

  return (
    <Dropdown trigger={['hover']} menu={{ items, onClick: handleClick }}>
      <Button type="link" size="small" style={{ paddingInline: 0, height: 'auto' }}>
        {label} <DownOutlined />
      </Button>
    </Dropdown>
  );
}
