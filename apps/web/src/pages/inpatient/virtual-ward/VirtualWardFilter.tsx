import { Input } from 'antd';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker';
import SearchActions from '@/components/common/SearchActions';
import DeptSelect from '@/components/business/DeptSelect';
import DoctorSelect from '@/components/business/DoctorSelect';
import type { VirtualWardFilters, VirtualWardTab } from './useVirtualWardQuery';

/** 普通控件统一宽度 */
const CONTROL_WIDTH = 160;
/** 日期区间需容纳两个日期输入 */
const RANGE_WIDTH = 220;
/** 控件间距 */
const CONTROL_GAP = 20;

interface VirtualWardFilterProps {
  tab: VirtualWardTab;
  filters: VirtualWardFilters;
  departments: DepartmentOption[];
  doctors: StaffOption[];
  onDepartmentChange: (value: string) => void;
  onDoctorChange: (value: string) => void;
  onPatch: (partial: Partial<VirtualWardFilters>) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
}

export default function VirtualWardFilter({
  tab,
  filters,
  departments,
  doctors,
  onDepartmentChange,
  onDoctorChange,
  onPatch,
  onSearch,
  onReset,
  loading,
}: VirtualWardFilterProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: CONTROL_GAP,
        alignItems: 'center',
      }}
    >
      <DeptSelect
        value={filters.departmentId}
        onChange={onDepartmentChange}
        options={departments}
        disabled={loading}
      />
      <DoctorSelect
        value={filters.doctorId}
        onChange={onDoctorChange}
        options={doctors}
        disabled={loading}
      />
      <Input
        style={{ width: CONTROL_WIDTH }}
        value={filters.patientNo}
        onChange={(event) => onPatch({ patientNo: event.target.value })}
        placeholder="住院号"
        allowClear
      />
      <Input
        style={{ width: CONTROL_WIDTH }}
        value={filters.name}
        onChange={(event) => onPatch({ name: event.target.value })}
        placeholder="姓名（精确）"
        allowClear
      />
      <Input
        style={{ width: CONTROL_WIDTH }}
        value={filters.bedNo}
        onChange={(event) => onPatch({ bedNo: event.target.value })}
        placeholder="床号"
        allowClear
      />
      {tab === 'CURRENT' ? (
        <DateRangePicker
          value={filters.joinRange}
          onChange={(value: DateRangeValue) => onPatch({ joinRange: value })}
          placeholder={['加入开始', '加入结束']}
          disabled={loading}
          style={{ width: RANGE_WIDTH }}
        />
      ) : (
        <DateRangePicker
          value={filters.leaveRange}
          onChange={(value: DateRangeValue) => onPatch({ leaveRange: value })}
          placeholder={['移出开始', '移出结束']}
          disabled={loading}
          style={{ width: RANGE_WIDTH }}
        />
      )}
      <SearchActions onSearch={onSearch} onReset={onReset} loading={loading} />
    </div>
  );
}
