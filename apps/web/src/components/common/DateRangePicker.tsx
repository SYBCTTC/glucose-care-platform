import { DatePicker } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import type { CSSProperties } from 'react';

const { RangePicker } = DatePicker;

export type DateRangeValue = [Dayjs, Dayjs] | null;

interface DateRangePickerProps {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  /** date：年月日；datetime：精确到秒 */
  precision?: 'date' | 'datetime';
  placeholder?: [string, string];
  disabled?: boolean;
  style?: CSSProperties;
}

/** 日期区间：禁止选择今天之后的日期 */
export default function DateRangePicker({
  value,
  onChange,
  precision = 'date',
  placeholder,
  disabled,
  style,
}: DateRangePickerProps) {
  return (
    <RangePicker
      value={value}
      onChange={(dates) => {
        if (dates && dates[0] && dates[1]) {
          onChange?.([dates[0], dates[1]]);
        } else {
          onChange?.(null);
        }
      }}
      showTime={precision === 'datetime' ? { format: 'HH:mm:ss' } : false}
      format={precision === 'datetime' ? 'YYYY-MM-DD HH:mm:ss' : 'YYYY-MM-DD'}
      disabledDate={(current) => (current ? current > dayjs().endOf('day') : false)}
      placeholder={placeholder}
      disabled={disabled}
      style={{ width: '100%', ...style }}
    />
  );
}
