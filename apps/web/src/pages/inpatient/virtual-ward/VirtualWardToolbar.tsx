import Tabs from '@/components/common/Tabs';
import { VIRTUAL_WARD_TABS, type VirtualWardTab } from './useVirtualWardQuery';

interface VirtualWardToolbarProps {
  value: VirtualWardTab;
  onChange: (value: VirtualWardTab) => void;
}

export default function VirtualWardToolbar({ value, onChange }: VirtualWardToolbarProps) {
  // 公共 Tabs 自带 8px 下边距，外层补 8px 保持与表格原 16px 间距
  return (
    <div style={{ marginBottom: 8 }}>
      <Tabs
        items={VIRTUAL_WARD_TABS}
        value={value}
        onChange={(key) => onChange(key as VirtualWardTab)}
        variant="underline"
      />
    </div>
  );
}
