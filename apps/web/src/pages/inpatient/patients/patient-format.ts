import dayjs from 'dayjs';
import { GENDER_LABELS } from '@gc/shared';
import type { Gender } from '@gc/shared';

/** 列表/卡片共用的展示格式化，缺值统一返回 "-" */
export function getGenderLabel(gender: string | null): string {
  if (!gender) {
    return '-';
  }
  return GENDER_LABELS[gender as Gender] ?? gender;
}

export function formatAge(age: number | null): string {
  return age === null ? '-' : `${age} 岁`;
}

export function formatHospitalDays(
  admissionAt: string | null,
  dischargeAt: string | null,
): string {
  if (!admissionAt) {
    return '-';
  }
  const end = dischargeAt ? dayjs(dischargeAt) : dayjs();
  const days = end.startOf('day').diff(dayjs(admissionAt).startOf('day'), 'day') + 1;
  return `${Math.max(days, 1)} 天`;
}

/**
 * 加入虚拟病区天数。
 *
 * ⚠️ 口径必须与上面的 formatHospitalDays **完全一致**（加入当天算 1 天，最小 1 天），
 * 两个函数刻意放在一起就是这个原因：同一张卡片上并排显示「住院天数」和
 * 「加入虚拟病区天数」，规则不同会被当成 bug。改一个必须同时改另一个。
 *
 * leftAt 非空（历史行）时以**移出时间**为终点，显示"曾在区多久"而不是"至今"。
 * 天数在前端算而非后端下发：跨零点后无需重新请求即自动 +1，也避免两套口径。
 */
export function formatWardDays(joinedAt: string, leftAt: string | null): string {
  if (!joinedAt) {
    return '-';
  }
  const end = leftAt ? dayjs(leftAt) : dayjs();
  const days = end.startOf('day').diff(dayjs(joinedAt).startOf('day'), 'day') + 1;
  return `${Math.max(days, 1)} 天`;
}

/** 卡片上的血糖时间：MM-DD HH:mm */
export function formatGlucoseTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  return dayjs(value).format('MM-DD HH:mm');
}
