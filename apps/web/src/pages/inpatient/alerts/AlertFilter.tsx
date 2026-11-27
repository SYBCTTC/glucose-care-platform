import { Input, InputNumber, Select } from 'antd';
import type { AlertAdmissionStatus } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker';
import SearchActions from '@/components/common/SearchActions';
import DeptSelect from '@/components/business/DeptSelect';
import DoctorSelect from '@/components/business/DoctorSelect';
import { TIME_PRESETS, TIME_PRESET_LABELS, type TimePreset } from './alert-time';
import type { AlertFilters } from './useAlertQuery';

/** 筛选控件统一宽度（同 PatientFilter） */
const CONTROL_WIDTH = 160;
/** 控件间距 20px：无设计令牌档位，沿 PatientFilter 局部常量先例（规格 §6） */
const CONTROL_GAP = 20;
/** 日期区间需容纳两个日期输入，单独放宽（同 PatientFilter） */
const RANGE_WIDTH = 220;
/** 大于/小于数值输入宽度 */
const NUMBER_WIDTH = 120;

/** 住院状态下拉（需求原文：全部/住院/出院） */
const ADMISSION_STATUS_OPTIONS: Array<{ value: AlertAdmissionStatus; label: string }> = [
  { value: 'all', label: '全部' },
  { value: 'inpatient', label: '住院' },
  { value: 'discharged', label: '出院' },
];

const TIME_OPTIONS = TIME_PRESETS.map((preset) => ({
  value: preset,
  label: TIME_PRESET_LABELS[preset],
}));

interface AlertFilterProps {
  filters: AlertFilters;
  departments: DepartmentOption[];
  doctors: StaffOption[];
  onDepartmentChange: (value: string) => void;
  onDoctorChange: (value: string) => void;
  onPatch: (partial: Partial<AlertFilters>) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
}

/**
 * 预警管理筛选区（P4-7 规格 §6）：科室/医生/住院号/姓名/床号与患者管理住院 Tab
 * 同口径（姓名密文精确、住院号/床号模糊）；住院状态默认「住院」、时间默认「本月」，
 * 选「自选时间区间」后在下拉之后追加日期区间控件；大于/小于为数值输入
 * （正数、至多 1 位小数，控件层约束；gt ≥ lt 不强拦，裁定 R2-Q4）。
 */
export default function AlertFilter({
  filters,
  departments,
  doctors,
  onDepartmentChange,
  onDoctorChange,
  onPatch,
  onSearch,
  onReset,
  loading,
}: AlertFilterProps) {
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
      <Select<AlertAdmissionStatus>
        aria-label="住院状态"
        style={{ width: CONTROL_WIDTH }}
        value={filters.admissionStatus}
        onChange={(value) => onPatch({ admissionStatus: value })}
        options={ADMISSION_STATUS_OPTIONS}
        disabled={loading}
      />
      <Select<TimePreset>
        aria-label="时间"
        style={{ width: CONTROL_WIDTH }}
        value={filters.timePreset}
        onChange={(value) => onPatch({ timePreset: value })}
        options={TIME_OPTIONS}
        disabled={loading}
      />
      {filters.timePreset === 'custom' ? (
        <DateRangePicker
          value={filters.customRange}
          onChange={(value: DateRangeValue) => onPatch({ customRange: value })}
          placeholder={['开始日期', '结束日期']}
          disabled={loading}
          style={{ width: RANGE_WIDTH }}
        />
      ) : null}
      <InputNumber
        aria-label="大于"
        style={{ width: NUMBER_WIDTH }}
        value={filters.valueGt}
        onChange={(value) => onPatch({ valueGt: value })}
        placeholder="大于"
        min={0.1}
        step={0.1}
        precision={1}
        disabled={loading}
      />
      <InputNumber
        aria-label="小于"
        style={{ width: NUMBER_WIDTH }}
        value={filters.valueLt}
        onChange={(value) => onPatch({ valueLt: value })}
        placeholder="小于"
        min={0.1}
        step={0.1}
        precision={1}
        disabled={loading}
      />
      <SearchActions onSearch={onSearch} onReset={onReset} loading={loading} />
    </div>
  );
}
