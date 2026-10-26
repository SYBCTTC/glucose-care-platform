import { z } from 'zod';

/**
 * 前后端统一日期时间格式：YYYY-MM-DD HH:mm:ss。
 * 约定：
 *  - 接口入参与出参的日期时间字段一律使用该格式，不使用 ISO 8601；
 *  - 字符串不带时区后缀，按运行环境本地时区解释（生产需确保 TZ=Asia/Shanghai）；
 *  - 纯日期字段（如出生日期）仍用 YYYY-MM-DD，不强制补时间。
 */
export const DATE_TIME_FORMAT = 'YYYY-MM-DD HH:mm:ss';
export const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/**
 * 接口日期时间入参：仅接受 YYYY-MM-DD HH:mm:ss，校验后转换为 Date。
 * 各接口 schema 直接复用它，避免每个接口各写一套校验。
 */
export const dateTimeStringSchema = z
  .string()
  .regex(DATE_TIME_PATTERN, `日期时间格式应为 ${DATE_TIME_FORMAT}`)
  .transform((value) => new Date(value.replace(' ', 'T')));

/** 接口日期时间出参：Date → YYYY-MM-DD HH:mm:ss（本地时区）；空值返回 null */
export function formatDateTime(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const pad = (input: number) => String(input).padStart(2, '0');
  const date = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  const time = `${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
  return `${date} ${time}`;
}

/** 纯日期（如出生日期）统一格式：YYYY-MM-DD，不带时间与时区后缀 */
export const DATE_ONLY_FORMAT = 'YYYY-MM-DD';
export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 接口纯日期入参：仅接受 YYYY-MM-DD。
 * 统一按 UTC 零点转 Date，避免运行环境时区把日期写成前一天（@db.Date 存 UTC 日期部分）。
 */
export const dateOnlyStringSchema = z
  .string()
  .trim()
  .regex(DATE_ONLY_PATTERN, `日期格式应为 ${DATE_ONLY_FORMAT}`)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), '日期不合法')
  .transform((value) => new Date(value));

/** 纯日期出参：Date → YYYY-MM-DD（按 UTC 取日期部分，与入库口径一致）；空值返回 null */
export function formatDateOnly(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`;
}
