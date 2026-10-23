import { Select } from 'antd';
import type { StaffOption } from '@/api/common-data';

/** "所有医生"的占位值：查询时不向后端传医生字段 */
export const ALL_DOCTOR = 'ALL';

interface DoctorSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  /** 已按选中科室过滤后的医生列表，由页面负责联动 */
  options: StaffOption[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 医生筛选组件。
 * 数据来源于公共数据 store（DY-DOCTOR），科室联动与默认值策略由页面 hook 负责。
 */
export default function DoctorSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = '医生',
}: DoctorSelectProps) {
  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      style={{ width: 160 }}
      options={[
        { value: ALL_DOCTOR, label: '所有医生' },
        ...options.map((item) => ({ value: item.id, label: item.name })),
      ]}
    />
  );
}
