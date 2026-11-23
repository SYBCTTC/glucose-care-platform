import { useCallback, useEffect, useState } from 'react';
import { GLUCOSE_RECORD_PAGE_SIZE } from '@gc/shared';
import type { GlucoseRecordListResponse } from '@gc/shared';
import { ApiError } from '@/api/client';
import { fetchGlucoseRecords } from '@/api/glucose';

export interface GlucoseRecordListState {
  data: GlucoseRecordListResponse | null;
  loading: boolean;
  /** 错误文案；null 表示无错误 */
  error: string | null;
  /** 是否越权（HTTP 403，跨科室数据范围拦截） */
  forbidden: boolean;
  /** 手动重取（错误后重试按钮用） */
  reload: () => void;
}

const IDLE: Omit<GlucoseRecordListState, 'reload'> = {
  data: null,
  loading: false,
  error: null,
  forbidden: false,
};

/**
 * 记录列表查询范围（R27）：与报表 `GlucoseReportRange` 同口径——
 * 秒粒度本地时间字符串（YYYY-MM-DD HH:mm:ss），字段缺省 = 该侧不限。
 * 独立类型不 import 报表的：两页的「已应用范围」演进可能分叉（记录页未来或加时段筛选），
 * 共享类型会让任一页的改动波及另一页。
 */
export interface GlucoseRecordRange {
  startTime?: string;
  endTime?: string;
}

/**
 * 拉取血糖记录列表（GET /patients/:id/glucose/records，R27）。
 *
 * 与 `useGlucoseReport` 同风格同语义（手写 useState/useEffect + `cancelled` 标志丢弃过期响应，
 * 全仓零 TanStack Query），触发重取的因素一字不差：
 *  - `patientId`：换患者；
 *  - `page`：翻页（服务端分页，`pageSize` 固定 15 条**记录**——注意与报表的 15 个「日期」语义不同）；
 *  - `version`：壳层「添加血糖」/ 本页复核弹窗编辑、作废成功后自增，列表立刻反映变化；
 *  - `range`：已应用的秒粒度查询范围（点「查询」/初始默认态/重置才更新，改表单不触发请求）；
 *  - `ready`：住院记录树未就绪时**不发请求**且 loading 恒真——初始加载必须按默认条件
 *    查询（R24 裁定 Q15 口径），不能先拉一次全量再拉一次默认范围。
 */
export function useGlucoseRecords(
  patientId: string | undefined,
  page: number,
  version: number,
  range: GlucoseRecordRange,
  ready: boolean,
): GlucoseRecordListState {
  const [state, setState] = useState({ ...IDLE, loading: Boolean(patientId) });
  const [nonce, setNonce] = useState(0);
  // 解构成原始值进依赖：range 是调用方持有的对象，整对象进依赖会因引用变化多拉一次
  const { startTime, endTime } = range;

  useEffect(() => {
    if (!patientId) {
      setState({ ...IDLE, error: '缺少患者 ID' });
      return;
    }
    if (!ready) {
      setState((prev) => ({ ...prev, loading: true }));
      return;
    }
    let cancelled = false;
    // 翻页时保留旧 data、只置 loading：表格显示 loading 遮罩而不是闪成空白
    setState((prev) => ({ ...prev, loading: true, error: null, forbidden: false }));

    const load = async (): Promise<void> => {
      try {
        const data = await fetchGlucoseRecords(patientId, {
          page,
          pageSize: GLUCOSE_RECORD_PAGE_SIZE,
          startTime,
          endTime,
        });
        if (!cancelled) {
          setState({ data, loading: false, error: null, forbidden: false });
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        const forbidden = error instanceof ApiError && error.status === 403;
        const message =
          error instanceof Error && error.message ? error.message : '加载血糖记录失败';
        setState({ data: null, loading: false, error: message, forbidden });
      }
    };
    void load();

    return () => {
      cancelled = true;
    };
  }, [patientId, page, version, nonce, startTime, endTime, ready]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { ...state, reload };
}
