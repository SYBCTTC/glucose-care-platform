import { Select } from 'antd';
import type { DepartmentOption } from '@/api/common-data';

/** "所有科室"的占位值：查询时不向后端传科室字段 */
export const ALL_DEPARTMENT = 'ALL';

interface DeptSelectProps {
  value?: string;
  onChange?: (value: string) => void;
  options: DepartmentOption[];
  disabled?: boolean;
  placeholder?: string;
}

/**
 * 科室筛选组件。
 * 默认值策略（≤3 默认第一个、>3 默认"所有科室"）由页面 hook 计算，
 * 组件本身只负责受控渲染，保证"所有科室"始终可选。
 */
export default function DeptSelect({
  value,
  onChange,
  options,
  disabled,
  placeholder = '科室',
}: DeptSelectProps) {
  return (
    <Select
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
      style={{ width: 160 }}
      options={[
        { value: ALL_DEPARTMENT, label: '所有科室' },
        ...options.map((item) => ({ value: item.id, label: item.name })),
      ]}
    />
  );
}
