import type {
  GlucoseCreateResult,
  GlucoseRecordDetail,
  GlucoseRecordListResponse,
  GlucoseReportResponse,
  GlucoseTrendResponse,
  GlucoseUpdateResult,
  GlucoseVoidResult,
} from '@gc/shared';
import { http } from './client';

/**
 * 添加血糖请求体（传输格式）。
 * 注意：shared 的 createGlucoseSchema 会把 measuredAt 转成 Date，
 * 这里必须按字符串传输（YYYY-MM-DD HH:mm:ss）。
 * `resultType` 传 `DETECT` 表示「这是一次真实读数」，由服务端判定 0/1/2。
 */
export interface CreateGlucosePayload {
  /** YYYY-MM-DD HH:mm:ss */
  measuredAt: string;
  /** TIME_SLOTS.code（含 RANDOM） */
  mealContext: string;
  /** `DETECT` 或 '3'~'9' */
  resultType: string;
  /** mmol/L；仅「检测」时有值 */
  valueMmolL?: number | null;
  /** 试纸数量（整数 0~999）；仅「检测」时可填 */
  testStrip?: number | null;
  operatorId: string;
  remark?: string | null;
}

/** 添加血糖（住院患者） */
export function createGlucose(
  patientId: string,
  payload: CreateGlucosePayload,
): Promise<GlucoseCreateResult> {
  return http.post<GlucoseCreateResult>(`/patients/${patientId}/glucose`, payload);
}

/**
 * 血糖报告查询参数（前端以字符串/数字传递，后端用共享 schema 校验）。
 *
 * R24（裁定 Q16）：原天粒度 `startDate/endDate` 升级为**秒粒度** `startTime/endTime`
 * （本地时间 `YYYY-MM-DD HH:mm:ss`，闭区间），由查询表单按住院/科室记录联动推导。
 */
export interface GlucoseReportParams {
  [key: string]: string | number | undefined;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime?: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime?: string;
  page?: number;
  /** 每页**日期数**（不是血糖记录条数），默认 15 */
  pageSize?: number;
}

/**
 * 血糖报告：日期 × 时段矩阵（只读）。
 * 属敏感查询，后端每次调用写一条 GLUCOSE_REPORT_VIEW 审计（含越权 DENIED）。
 */
export function fetchGlucoseReport(
  patientId: string,
  params: GlucoseReportParams = {},
): Promise<GlucoseReportResponse> {
  return http.get<GlucoseReportResponse>(`/patients/${patientId}/glucose/report`, params);
}

/**
 * R27：血糖记录列表查询参数（前端以字符串/数字传递，后端用共享 schema 校验）。
 * 时间口径与报表一致：秒粒度本地时间 `YYYY-MM-DD HH:mm:ss` 闭区间，单侧不传则该侧不限。
 */
export interface GlucoseRecordParams {
  [key: string]: string | number | undefined;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime?: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime?: string;
  page?: number;
  /** 每页**记录条数**（不是日期数），固定 15（GLUCOSE_RECORD_PAGE_SIZE），无条数切换器 */
  pageSize?: number;
}

/**
 * R27：血糖记录列表（平铺分页 + 统计栏，统计口径与报表一致——裁定 Q8）。
 * 属敏感查询，后端每次调用写一条 GLUCOSE_RECORD_QUERY 审计（含越权 DENIED）。
 */
export function fetchGlucoseRecords(
  patientId: string,
  params: GlucoseRecordParams = {},
): Promise<GlucoseRecordListResponse> {
  return http.get<GlucoseRecordListResponse>(`/patients/${patientId}/glucose/records`, params);
}

/**
 * P3-7：血糖趋势查询参数（前端以字符串传递，后端用共享 schema 校验）。
 * 时间口径与报表/记录一致：秒粒度本地时间 `YYYY-MM-DD HH:mm:ss` 闭区间，单侧不传则该侧不限。
 * **无分页**：趋势图返回范围内全部数值点。
 */
export interface GlucoseTrendParams {
  [key: string]: string | undefined;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限起点 */
  startTime?: string;
  /** YYYY-MM-DD HH:mm:ss，本地时间，含该秒；不传则不限终点 */
  endTime?: string;
  /** 时段过滤：逗号分隔的 mealContext 码（如 `FASTING,BEDTIME`）；不传 = 不过滤（「全部」） */
  mealContexts?: string;
}

/**
 * P3-7：血糖趋势（原始测量点散点/折线 + 阈值 + 统计栏，统计口径与报表一致）。
 * 属敏感查询，后端每次调用写一条 GLUCOSE_TREND_VIEW 审计（含越权 DENIED）。
 */
export function fetchGlucoseTrend(
  patientId: string,
  params: GlucoseTrendParams = {},
): Promise<GlucoseTrendResponse> {
  return http.get<GlucoseTrendResponse>(`/patients/${patientId}/glucose/trend`, params);
}

/**
 * R25：单条血糖详情（review/编辑弹框回填）。
 * 后端不单独审计（报表查询已留痕）；记录不存在/已作废 → 41001（拦截器 toast，调用方刷新报表）。
 */
export function fetchGlucoseDetail(
  patientId: string,
  recordId: string,
): Promise<GlucoseRecordDetail> {
  return http.get<GlucoseRecordDetail>(`/patients/${patientId}/glucose/${recordId}`);
}

/**
 * R25：编辑血糖。请求体与添加完全一致（复用 createGlucoseSchema 口径）。
 * 编辑撞检测时间 → 41003（字段级挂 measuredAt）；并发冲突 → 10008。
 */
export function updateGlucose(
  patientId: string,
  recordId: string,
  payload: CreateGlucosePayload,
): Promise<GlucoseUpdateResult> {
  return http.patch<GlucoseUpdateResult>(`/patients/${patientId}/glucose/${recordId}`, payload);
}

/**
 * R25：作废血糖（软删除）。HTTP DELETE，但后端只置 voidedAt/voidedById，不物理删行。
 * 需要 glucose:delete 权限（仅护士长/系统管理员）；重复作废 → 10008。
 */
export function voidGlucose(patientId: string, recordId: string): Promise<GlucoseVoidResult> {
  return http.delete<GlucoseVoidResult>(`/patients/${patientId}/glucose/${recordId}`);
}

/* -------------------------------------------------------------------------- */
/* R28：血糖数据打印（docs/specs/glucose-print.md §3）                           */
/* -------------------------------------------------------------------------- */

/**
 * 打印全量拉取的页大小：取查询契约上限（glucoseReportQuerySchema / glucoseRecordQuerySchema
 * 的 pageSize max=100），不放宽服务端校验（裁定 Q12：全量拉取、不设总量上限）。
 */
const PRINT_FETCH_PAGE_SIZE = 100;

/** 打印取数范围：与 R24 appliedRange 同形（秒粒度本地时间串，单侧可缺省） */
export interface GlucosePrintRange {
  startTime?: string;
  endTime?: string;
}

/**
 * R28：打印用**全量**血糖报告（裁定 B1：已应用范围内全部日期，不止当前分页页）。
 * 报表按日期数服务端分页（total = 日期数）：先拉第 1 页拿 total，再并行拉余页合并 rows。
 * stats/columns 是范围级口径（与页无关），沿用第 1 页响应的。
 */
export async function fetchAllGlucoseReport(
  patientId: string,
  range: GlucosePrintRange,
): Promise<GlucoseReportResponse> {
  const first = await fetchGlucoseReport(patientId, {
    ...range,
    page: 1,
    pageSize: PRINT_FETCH_PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(first.total / PRINT_FETCH_PAGE_SIZE));
  if (pageCount === 1) {
    return first;
  }
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      fetchGlucoseReport(patientId, {
        ...range,
        page: index + 2,
        pageSize: PRINT_FETCH_PAGE_SIZE,
      }),
    ),
  );
  return { ...first, rows: [first.rows, ...rest.map((part) => part.rows)].flat() };
}

/**
 * R28：打印用**全量**血糖记录（裁定 B1/Q12）。记录按条数服务端分页（total = 记录数），
 * 循环拉页合并 items；stats 是范围级口径，沿用第 1 页响应的。
 */
export async function fetchAllGlucoseRecords(
  patientId: string,
  range: GlucosePrintRange,
): Promise<GlucoseRecordListResponse> {
  const first = await fetchGlucoseRecords(patientId, {
    ...range,
    page: 1,
    pageSize: PRINT_FETCH_PAGE_SIZE,
  });
  const pageCount = Math.max(1, Math.ceil(first.total / PRINT_FETCH_PAGE_SIZE));
  if (pageCount === 1) {
    return first;
  }
  const rest = await Promise.all(
    Array.from({ length: pageCount - 1 }, (_, index) =>
      fetchGlucoseRecords(patientId, {
        ...range,
        page: index + 2,
        pageSize: PRINT_FETCH_PAGE_SIZE,
      }),
    ),
  );
  return { ...first, items: [first.items, ...rest.map((part) => part.items)].flat() };
}

/**
 * R28：打印留痕请求体（传输格式）。
 * 不用 z.infer 的 GlucosePrintInput——那是服务端 transform 后的类型（startTime 已是 Date），
 * 前端按契约传字符串（同 CreateGlucosePayload 的先例）。
 */
export interface GlucosePrintPayload {
  printType: 'report' | 'record' | 'trend';
  /** YYYY-MM-DD HH:mm:ss，本地时间；不传 = 该侧不限（与查询口径一致） */
  startTime?: string;
  endTime?: string;
  /** 打印范围内 counted=true 记录数（stats.total 口径，裁定 17） */
  count: number;
}

/** 打印留痕响应（回显审计 detail 字段） */
export interface GlucosePrintResult {
  printType: GlucosePrintPayload['printType'];
  rangeFrom: string | null;
  rangeTo: string | null;
  count: number;
}

/**
 * R28：打印留痕（裁定 Q10/Q11）。预览 Modal 点「打印」时调用，服务端记
 * GLUCOSE_PRINT 审计（detail.printType/rangeFrom/rangeTo/count）；**成功后**调用方
 * 才触发 window.print，失败则不打印（拦截器已 toast）。需 glucose:print 权限。
 */
export function reportGlucosePrint(
  patientId: string,
  payload: GlucosePrintPayload,
): Promise<GlucosePrintResult> {
  return http.post<GlucosePrintResult>(`/patients/${patientId}/glucose/print`, payload);
}
