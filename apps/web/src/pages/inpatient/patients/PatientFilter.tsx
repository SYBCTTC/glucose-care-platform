import { Input } from 'antd';
import { PATIENT_STATUS } from '@gc/shared';
import type { PatientStatus } from '@gc/shared';
import type { DepartmentOption, StaffOption } from '@/api/common-data';
import DateRangePicker, { type DateRangeValue } from '@/components/common/DateRangePicker';
import SearchActions from '@/components/common/SearchActions';
import DeptSelect from '@/components/business/DeptSelect';
import DoctorSelect from '@/components/business/DoctorSelect';
import type { PatientFilters } from './usePatientQuery';

/** 筛选控件统一宽度（含日期区间） */
const CONTROL_WIDTH = 160;
/** 控件间距 */
const CONTROL_GAP = 20;
/** 日期区间需容纳两个日期输入，单独放宽 */
const RANGE_WIDTH = 220;

interface PatientFilterProps {
  status: PatientStatus;
  filters: PatientFilters;
  departments: DepartmentOption[];
  doctors: StaffOption[];
  onDepartmentChange: (value: string) => void;
  onDoctorChange: (value: string) => void;
  onPatch: (partial: Partial<PatientFilters>) => void;
  onSearch: () => void;
  onReset: () => void;
  loading: boolean;
}

export default function PatientFilter({
  status,
  filters,
  departments,
  doctors,
  onDepartmentChange,
  onDoctorChange,
  onPatch,
  onSearch,
  onReset,
  loading,
}: PatientFilterProps) {
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
      <DateRangePicker
        value={filters.admissionRange}
        onChange={(value: DateRangeValue) => onPatch({ admissionRange: value })}
        placeholder={['入院开始', '入院结束']}
        disabled={loading}
        style={{ width: RANGE_WIDTH }}
      />
      {status === PATIENT_STATUS.DISCHARGED ? (
        <DateRangePicker
          value={filters.dischargeRange}
          onChange={(value: DateRangeValue) => onPatch({ dischargeRange: value })}
          placeholder={['出院开始', '出院结束']}
          disabled={loading}
          style={{ width: RANGE_WIDTH }}
        />
      ) : null}
      <SearchActions onSearch={onSearch} onReset={onReset} loading={loading} />
    </div>
  );
}
