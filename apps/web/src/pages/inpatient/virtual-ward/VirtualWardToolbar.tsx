import Tabs from '@/components/common/Tabs';
import { VIRTUAL_WARD_TABS, type VirtualWardTab } from './useVirtualWardQuery';

interface VirtualWardToolbarProps {
  value: VirtualWardTab;
  onChange: (value: VirtualWardTab) => void;
}

export default function VirtualWardToolbar({ value, onChange }: VirtualWardToolbarProps) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Tabs
        items={VIRTUAL_WARD_TABS}
        value={value}
        onChange={(key) => onChange(key as VirtualWardTab)}
        variant="underline"
      />
    </div>
  );
}
