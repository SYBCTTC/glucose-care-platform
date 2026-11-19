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

/* -------------------------------------------------------------------------- */
/* 本地时区口径（服务 timestamptz 列）                                          */
/* -------------------------------------------------------------------------- */

/**
 * 本地纯日期出参：Date → YYYY-MM-DD（按**运行环境本地时区**取日期部分）；空值返回 null。
 *
 * ⚠️ 与上面的 `formatDateOnly`（**UTC** 口径）不可混用，选错会静默错一天：
 *  - `formatDateOnly` 服务 `@db.Date` 列（如出生日期）——这类列存的就是 UTC 日期部分，
 *    用本地 getter 反而会把日期读成后一天；
 *  - `formatLocalDate` 服务 `timestamptz` 列（如 `GlucoseRecord.measuredAt`）——存的是 UTC 时刻，
 *    而业务上的"哪一天"必须按本地日历日算。若误用 UTC 版本，
 *    **北京时间 00:00–08:00 的记录会被归到前一天**（血糖报表按日分组时即为医疗数据错误）。
 */
export function formatLocalDate(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

/**
 * 本地时间出参：Date → HH:mm（按运行环境本地时区，不含秒）；空值返回 null。
 * 与 `formatDateTime` 同为本地口径，区别是只取时分。
 */
export function formatLocalTime(value: Date | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const pad = (input: number) => String(input).padStart(2, '0');
  return `${pad(value.getHours())}:${pad(value.getMinutes())}`;
}

/**
 * 本地纯日期入参：'YYYY-MM-DD' → 该日**本地零点**的 Date；格式非法或日期不存在返回 null。
 *
 * ⚠️ 与上面的 `dateOnlyStringSchema`（**UTC** 零点）不可混用：后者服务 `@db.Date` 列；
 * 本函数服务 `timestamptz` 列的**本地日历日**范围过滤。若用 UTC 零点做本地日界，
 * 过滤范围会整体偏移 8 小时（漏掉或多算一整天）。
 *
 * 刻意不用 `new Date('YYYY-MM-DD')`：该写法按 UTC 解析。这里用 `new Date(y, m - 1, d)` 走本地构造，
 * 并回环校验以拒绝 `2026-02-30` 这类被 Date 自动进位的非法日期。
 */
export function parseLocalDate(value: string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!DATE_ONLY_PATTERN.test(trimmed)) {
    return null;
  }
  const [year, month, day] = trimmed.split('-').map(Number);
  const date = new Date(year, month - 1, day);
  return formatLocalDate(date) === trimmed ? date : null;
}
