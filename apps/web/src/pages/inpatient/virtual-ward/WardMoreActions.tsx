import { useMemo } from 'react';
import { DownOutlined } from '@ant-design/icons';
import { Button, Dropdown, Modal } from 'antd';
import type { MenuProps } from 'antd';
import { WARD_TAB } from '@gc/shared';
import type { VirtualWardListItem, WardTab } from '@gc/shared';

interface WardMoreActionsProps {
  patient: VirtualWardListItem;
  /** 当前 Tab 决定唯一那一项是「移除」还是「加入」 */
  tab: WardTab;
  /** 是否有 ward:manage 权限：无权限时整个菜单不渲染，操作列留空 */
  canManage: boolean;
  /** 正在提交的患者 ID；非空时禁用本行菜单，防连点重复提交 */
  pendingId: string | null;
  onConfirm: (patient: VirtualWardListItem) => void;
}

/**
 * 虚拟病区页的操作菜单。
 *
 * 与患者管理的 PatientMoreActions 不同，这里**只有一个菜单项**（2026-11-17 需求人裁定：
 * 不要编辑患者信息 / 添加血糖 / 查看详情）：当前 Tab 是「移除虚拟病区」，
 * 历史 Tab 是「加入虚拟病区」（= 重新加入，后端新建一条记录、旧历史行保留）。
 *
 * ⚠️ 确认框用 `Modal.confirm` 而非需求最初说的 `Popconfirm`（2026-11-18 裁定方案 A）：
 * Popconfirm 需要持续存在的锚点元素，而 Dropdown 菜单项被点击后菜单立即关闭、
 * 锚点随之卸载，气泡弹不出来。Modal 是命令式 API、不依赖锚点，交互等价。
 *
 * ⚠️ 必须用 `Modal.useModal()` 而不是静态 `Modal.confirm`：主题（暗色 + 字号档）
 * 是通过 App.tsx 的 ConfigProvider 下发的，静态方法渲染在 React 树之外拿不到上下文，
 * 暗色模式下会弹出白底对话框。
 */
export default function WardMoreActions({
  patient,
  tab,
  canManage,
  pendingId,
  onConfirm,
}: WardMoreActionsProps) {
  const [modal, contextHolder] = Modal.useModal();
  const isCurrent = tab === WARD_TAB.CURRENT;
  const label = isCurrent ? '移除虚拟病区' : '加入虚拟病区';

  const items = useMemo<NonNullable<MenuProps['items']>>(() => [{ key: 'ward', label }], [label]);

  if (!canManage) {
    return null;
  }

  const handleClick: MenuProps['onClick'] = () => {
    modal.confirm({
      title: label,
      content: `确认将 ${patient.nameMasked} ${isCurrent ? '移出' : '加入'}虚拟病区？`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => onConfirm(patient),
    });
  };

  return (
    <>
      {contextHolder}
      <Dropdown trigger={['hover']} menu={{ items, onClick: handleClick }}>
        <Button
          type="link"
          size="small"
          disabled={pendingId !== null}
          style={{ paddingInline: 0, height: 'auto' }}
        >
          更多操作 <DownOutlined />
        </Button>
      </Dropdown>
    </>
  );
}
