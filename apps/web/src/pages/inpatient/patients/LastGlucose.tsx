import { Typography } from 'antd';
import { DICT_TYPE } from '@gc/shared';
import { useCommonDataStore } from '@/store/common-data';

/** 数值型结果（0 偏低 / 1 正常 / 2 偏高）：展示具体数值 */
const VALUE_RESULT_CODES = new Set(['0', '1', '2']);

interface LastGlucoseProps {
  /** 结果类型 code，取值见 DICT_TYPE.GLUCOSE_RESULT（'0'~'9'） */
  resultType: string | null;
  /** 血糖值 mmol/L；非数值类型（'3'~'9'）为 null */
  value: number | null;
}

/**
 * 最近一次血糖。
 * - 数值型（0/1/2）：`5.2 mmol/L`，数值用字典色、单位用正文色
 * - 非数值型（3~9）：只显示类型标签（Low / High / 拒检…），颜色取字典 color
 */
export default function LastGlucose({ resultType, value }: LastGlucoseProps) {
  const dicts = useCommonDataStore((state) => state.dicts);
  const resultTypes = dicts[DICT_TYPE.GLUCOSE_RESULT] ?? [];

  if (!resultType) {
    return <>-</>;
  }

  const item = resultTypes.find((option) => option.code === resultType);

  if (VALUE_RESULT_CODES.has(resultType)) {
    if (value === null) {
      return <>-</>;
    }
    return (
      <Typography.Text strong>
        <span style={{ color: item?.color ?? undefined }}>{value.toFixed(1)}</span>
        <span style={{ color: 'var(--gc-color-text)' }}> mmol/L</span>
      </Typography.Text>
    );
  }

  return (
    <Typography.Text strong style={{ color: item?.color ?? undefined }}>
      {item?.label ?? resultType}
    </Typography.Text>
  );
}
