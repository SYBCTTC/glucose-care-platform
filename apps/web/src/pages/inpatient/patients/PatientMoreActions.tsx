import { useMemo } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, Tooltip, message } from 'antd';
import type { MenuProps } from 'antd';
import type { PatientListItem } from '@gc/shared';

const ACTION_LABELS: Record<string, string> = {
  edit: '编辑患者信息',
  glucose: '添加血糖',
  ward: '加入虚拟病区',
  wardJoined: '已加入虚拟病区',
  detail: '查看详情',
};

interface PatientMoreActionsProps<T extends PatientListItem> {
  patient: T;
  /** 列表用「更多操作」，卡片用「更多」 */
  label?: string;
  /** 是否有患者编辑权限：无权限时「编辑患者信息」整项不展示 */
  canEdit: boolean;
  /** 置灰原因（出院患者传值）：有值时编辑项置灰并提示，不隐藏 */
  editDisabledReason?: string;
  /** 是否有添加血糖权限：无权限时整项不展示（出院患者也不展示） */
  canCreateGlucose?: boolean;
  /** 是否有虚拟病区操作权限（ward:manage）：无权限时整项不展示 */
  canJoinWard?: boolean;
  onEdit: (patient: T) => void;
  onAddGlucose?: (patient: T) => void;
  onJoinWard?: (patient: T) => void;
}

/**
 * 患者列表/卡片共用的操作菜单。
 *
 * 泛型 `T`：调用方（PatientTable / PatientCardGrid）的行类型可能是 `PatientListItem`
 * 或其子类型 `VirtualWardListItem`，回调参数必须与行类型一致，否则 `strictFunctionTypes`
 * 下 `(patient: T) => void` 无法赋给 `(patient: PatientListItem) => void`（参数逆变）。
 */
export default function PatientMoreActions<T extends PatientListItem>({
  patient,
  label = '更多操作',
  canEdit,
  editDisabledReason,
  canCreateGlucose = false,
  canJoinWard = false,
  onEdit,
  onAddGlucose,
  onJoinWard,
}: PatientMoreActionsProps<T>) {
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
    if (canJoinWard) {
      result.push({
        key: 'ward',
        // 已在区时置灰而非隐藏：让医护明确知道"这个患者已经在里面了"，
        // 隐藏会使人以为功能不存在（2026-11-17 需求人裁定）
        label: patient.inVirtualWard ? ACTION_LABELS.wardJoined : ACTION_LABELS.ward,
        disabled: patient.inVirtualWard,
      });
    }
    result.push({ type: 'divider' }, { key: 'detail', label: ACTION_LABELS.detail });
    return result;
  }, [canEdit, editDisabledReason, canCreateGlucose, canJoinWard, patient.inVirtualWard]);

  const handleClick: MenuProps['onClick'] = ({ key }) => {
    if (key === 'edit') {
      onEdit(patient);
      return;
    }
    if (key === 'glucose') {
      onAddGlucose?.(patient);
      return;
    }
    if (key === 'ward') {
      // 置灰项 antd 本就不会触发 onClick，这里再挡一道，防止将来去掉 disabled 后误提交
      if (!patient.inVirtualWard) {
        onJoinWard?.(patient);
      }
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
