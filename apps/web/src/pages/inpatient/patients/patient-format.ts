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

/** 卡片上的血糖时间：MM-DD HH:mm */
export function formatGlucoseTime(value: string | null): string {
  if (!value) {
    return '-';
  }
  return dayjs(value).format('MM-DD HH:mm');
}
